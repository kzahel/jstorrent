# Client Surfaces

Tactical [386](../tactical/386-browser-handoff-and-report-context.md) repairs
the website/extension handoff after Cloudflare's `.html` to extensionless
redirect. Both exact URL spellings are accepted by the page, external-message
allowlist and worker; query/fragment/foreign-frame rejection is retained.
Legacy launch/add pages preserve torrent input and offer direct-library
recovery without treating failed messaging as proof of missing installation.
Old `{ok: true}` and `{handled: true}` acknowledgements remain supported,
without claiming durable addition or completion from a handoff receipt.

The packaged browser smoke follows a real redirect into the candidate
extension. Physical ChromeOS evidence also passes a controlled 4 MiB Android
transfer interrupted by source pause/process restart, independent byte
verification, normal delete-data removal, native restart absence and live
extension absence after another app restart/reloaded extension worker and view. The app
uses a fresh debug identity and the extension an isolated unpacked beta
identity; gateway preference setup is a fixture, pairing approval is real,
and production installation/setup is not established by that run. Owners,
tabs, package, extension and payload artifacts are cleaned up.
The website is publicly verified from `0f128550`; extension 1.1.7 passes
hosted packaging/live compatibility and is pending Google review, with 1.1.6
still public at the submission checkpoint. The submitted client decoder and
exact tested ZIP/store receipt are retained without a first-public claim.

Tactical [384](../tactical/384-shared-translation-workflow-and-desktop-german.md)
adds a German development preview to shared React and the native desktop
shell. Desktop native code owns system/override resolution, preference
persistence, menus and future notification language; the renderer subscribes
to locale changes without rebuilding the application service. Browser-only
surfaces keep their language preference locally. Release locale support is
still English; Android retains its platform-native ownership from 383.


Tactical [383](../tactical/383-android-translation-cohorts.md) adds Android
Settings → Language with a system default and remembered local override.
Android 13+ uses its native app-locale owner; earlier supported versions use
localized application/activity/service contexts. German is a debug preview;
release resources remain English. Locale recreation retains navigation,
settings drafts, playback position and the engine lifetime, while notification
text and channel labels refresh without replaying completion events.

Tactical [377](../tactical/377-compatible-touchless-release-channels.md) labels
About's selector **Stable — Recommended** and **Latest — Early access**.
Returning to Stable saves the choice and waits for a newer release that supports
both the actual databases and their immutable migration history. Signed macOS
ARM, Windows x64 and Linux x64 runs prove incompatible Stable waiting and
compatible unattended catch-up. Closed-window macOS, foreground macOS,
minimized Windows and Linux behind an independent editor retain their intended
presentation; background typing checks pass. The user's separate automatic
setting persists, and service permission gates each channel/native target.
Intel macOS under Rosetta additionally passes input during the actual startup
gap, without foreground reacquisition. Both channels are service-enabled for
macOS ARM/x64, Windows x64 and Linux x64; Linux ARM stays manual. See 377 for
exact evidence, remaining architecture coverage and release holds.

Tactical [355](../tactical/355-automatic-updates.md) now implements unattended
desktop updates through one native host owner, including with the window
closed. Maintainer direction accepts restarting after 15 minutes without
interaction, briefly interrupting and resuming downloads/seeding. Native,
extension and remote interaction plus unfinished flows/playback gate restart.
Relaunch preserves foreground versus non-foreground intent without restoring
exact window stacking order; minimized and closed/hidden windows stay that
way. Explicit Quit and newer focus choices take precedence. No notice,
installer or startup window may interrupt another application.
Qualification requires synthetic A-to-B signed updates in Machine Control
VMs, with guest-native focus/visibility observation and keyboard input into
an independent editor throughout background updates. Exact window ordering
is outside the assertions. The native owner, shared activity/control UI and
native synthetic runners are implemented. macOS ARM64 passes repeated window
matrices, full idle intervals and controlled transfer resumption; Windows and
Linux ARM64 synthetic presentation matrices also pass.
Default-on for qualified targets, a 60-second notice and one-hour snooze are
accepted. Tactical 377 extends this synthetic evidence with actual shipping-signed
packages and explicit per-target rollout; unrun 355 cases remain separate
qualification gaps rather than evidence for an untested architecture.

Tactical [376](../tactical/376-android-media-library.md) adds the media
Library to Android as a second primary destination, **Torrents | Library**:
a navigation bar at compact widths, a rail from 600 dp, hidden while torrent
selection owns the bottom bar, with the last destination remembered in
`product_ui`. The torrent list is now called Torrents in code and copy. The
Library leases one `library_media` page per query, shows only a page stamped
with the current request, and offers the web presets, search, sort,
availability and archived scope, in-place shows/albums/torrents with Back,
pages and Files-tab-style rows with progress and a ⋮ sheet (Play, Open with…,
Open containing folder, Show in torrent, which scrolls the torrent's Files tab
to the file). Rows only; audio playback, cards and
persisted filters are deferred. Fresh API 28 phone and API 35 tablet emulators
and a live seeded-host scenario on phone and tablet AVDs pass.

Tactical [374](../tactical/374-android-transfer-status-presentation.md) repairs
Android transfer presentation: completed cards show uploaded totals and ratio,
metadata acquisition is named explicitly, and only queued rows show queue
positions. The idle-rate header and ongoing notification describe metadata,
starting, checking and seeding work through the existing lifetime classifier.
No engine or generated contract changes are included. Pixel Sintel diagnosis
finds peer-metadata waiting and tracker timeouts; the debug sample's valid
`xs` metainfo URL and `ws` webseed are not consumed by the current magnet parser.
Validation and data-preserving development delivery are recorded in 374.


Tactical [373](../tactical/373-file-selection-bitmaps-and-download-safety.md)
implements download-safety settings, Files reasons and explicit overrides in
React, Compose and SwiftUI, backed by the common Rust policy/storage. Web and
Compose All previews respect safety. Android/iOS omit the Windows/macOS label
switch. Native builds and remaining runtime/platform qualification are recorded
in 373; no unsupported-platform label support or release follows.

Tactical [360](../tactical/360-remote-controller-subdomain.md) deploys the
hosted controller independently at `remote.jstorrent.com`, starting with
remote-v0.3.2. Main/PR builds test it; tagged releases gate production on the
live compatibility matrix and an immutable root-hosted browser artifact.
Marketing stays on main and old controller documents redirect with query and
fragment continuity. Frozen old assets retain already-open tabs through the
compatibility window. Fresh browser approval is required at the new origin;
native clients and remote host support do not expand.

Tactical [372](../tactical/372-ci-packaging-and-presentation-regressions.md)
orders Android pending-selection presentation requests before asynchronous
service startup dispatch. A delayed initial clear cannot close a newer restored
file-list subscription, and a dismissed selection cannot reopen. Two controlled
dispatch-order regressions fail before and pass after the change.
All 206 JVM cases, lint, the regenerated dual-ABI boundary and the full owned
API 35 ARM64 SAF selection/restart/recheck/hash/removal profile pass locally.
Handles peak at 3/40 for selective and 6/40 for Download all; AVD cleanup passes.
Hosted x86_64 qualification of these edits remains separate.

Tactical [340](../tactical/340-windows-quiet-network-startup.md) extends quiet
fresh/first-upgrade incoming and UPnP defaults to Windows. Explicit later choices,
ports, torrent intent/data and shell preferences survive. An isolated native
Windows VM qualifies fresh/upgrade/relaunch, shared disclosure/atomic Off,
persistent firewall Cancel, production-origin native attach and independently
hashed cross-VM uTP/TCP downloads while Off and denied. The shared disclosure
is platform-neutral; Network details offers conditional OS firewall recovery
without inferring a grant. Signed shipping, regrant and external inbound/WAN
reachability remain unqualified. Linux/Android/iOS defaults are unchanged.

Tactical [339](../tactical/339-macos-quiet-network-startup.md) implements quiet Mac defaults and first-upgrade
network holds, complete common incoming-Off semantics, and two concise shared
settings controls. Explicit forwarding gets an explanation before discovery.
Native fresh/upgrade/relaunch, production-origin control and independently
hashed outbound uTP/TCP fallback pass on the isolated Mac VM. Ad-hoc builds still
show the executable name and repeat local-network requests after denial/relaunch;
Developer ID denial persistence, regrant and branding remain shipping gates.
Windows product defaults/migration and bounded firewall evidence follow in 340.
Tactical 338 retains the earlier Mac/Windows research; its TCP-Off uTP admission
and diagnostic payload failures describe the old source, corrected by 339.

Tactical [337](../tactical/337-lightweight-macos-development-bundle.md) adds
the separate macOS `scripts/desktop-bundle` development launcher. It assembles
the ordinary debug client/helper into an ad-hoc signed `.app` with matching
identity and icon, then execs the inner client in the foreground. The normal
development library is shared with the unchanged raw `scripts/desktop` path;
shipping data/identity remain separate. Build-only does not register anything;
launching repairs Chrome's shared native-host route to the development bundle.
Foreground/Ctrl+C, rebuild refusal and isolated production-ID extension
launch/lifecycle qualification pass locally. This is not release packaging.

Tactical [325](../tactical/325-android-ci-library-readiness.md) repairs the
owned Android CI first-use assertion to observe All after statistics opt-out.
The unchanged APK fails before and passes the full API 35 ARM64 SAF lifecycle
after the harness fix, with exact hashes/removal, bounded handles and AVD
cleanup. Product behavior is unchanged; release source 5fa018ff passes the hosted
Android/SAF job in CI 38316599207.

Tactical [322](../tactical/322-android-empty-filter-navigation.md) replaces
Android's empty filtered-library hint with a `View all torrents` text button
when All has torrents. The action selects and reveals All. An entirely empty
library shows Add guidance on every tab; archive-only libraries retain the
filter hint where All would also be empty.

Tactical [320](../tactical/320-chromeos-android-owned-extension-setup.md) locally
qualifies Android-owned ChromeOS setup on both physical API-33 cohorts: a direct
production JSTorrent link, native notification/companion setup, exact HTTPS
UI-only return and explicit offline/permission/retry recovery. Actual pairing
rejection/expiry, approval, reload, app restart and singleton checks pass with
isolated identities. Public hosted/store delivery remains separate.


Tactical [316](../tactical/316-archived-torrents-and-android-selection-actions.md)
gives Android an Archived library tab; All and the other tabs exclude archived
torrents. Selection mode uses a contextual top bar (close, count, select all),
Back to exit, and a labeled bottom bar (Resume, Pause, Archive or Restore,
Remove, More with queue moves, Force recheck and Copy magnet links). Actions
apply only to eligible torrents. Archive/Restore offer Undo; the detail screen
shows an Archived banner with Restore and gates Files Download now. Rejected
torrent commands appear as a transient snackbar instead of the library error
card. React disables Start, queue moves and Download now for archived rows.
Tactical [318](../tactical/318-android-duplicate-add-feedback.md) makes every
Android add report torrents already in the session; when a match is archived
the snackbar offers Restore. Debug test torrents honor the file selection
setting instead of always quick-adding.

Tactical [314](../tactical/314-android-presentation-shutdown-race.md) repairs
Android presentation requests racing native-client release. The repository
closes terminally under its acquisition mutex, reports active setup errors,
and releases partial subscription groups on failure/cancellation. The version-28
production stack's exact generated line maps to the destroyed-client guard;
local regressions and dual-ABI build pass. Store delivery remains separate.

Completed remote MP4/M4V playback is implemented by the lazy browser
playsvideo consumer in [313](../tactical/313-completed-remote-video-playback.md).
Its Files/Library dialog reuses authenticated reliable ranges, owns cancellation
and circuit teardown, and changes no native Android/iOS boundary. Initial
qualification is local Playwright Chromium; Chrome/Edge are the intended scope,
with broader codecs, browsers, high-bitrate movies and WAN evidence deferred.

Tactical [310](../tactical/310-concise-first-use-and-background-setup.md)
shortens the React/Android first-use statistics choice and leaves recipient
details in the feedback preview. Android Library setup offers a folder first,
then explicit background downloads with Enable/Not now. Enable uses the existing
permission-and-preference action; permission alone cannot hide a disabled
background setting. Background seeding stays separately off by default.

Tactical [308](../tactical/308-android-optional-add-selection.md) makes Android
magnet selection optional per add. Manual and external magnets offer Download
all immediately or Choose files; external sources use one concise Add torrent
confirmation with the available name and folder. Local file intake and restored
pending adds can also proceed without waiting for a catalog. Explicit file
selection keeps the bounded checklist, source defaults and future preference.
Quick adds suppress intermediate pending presentation until the authoritative
summary reflects confirmation. Web and iOS presentation stay unchanged.

Tactical [302](../tactical/302-desktop-external-links.md) repairs shared About
support and release navigation. Browser clients retain native isolated-tab
anchors; desktop bootstrap injects the official Tauri opener through a small
shared link provider. Desktop URL permissions cover only the approved support
and release destinations, and opening failures show generic localized retry
feedback. Engine/API/media authority and native Android/iOS presentation are
unchanged. Exact validation and native handoff evidence are in the tactical.

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

Tactical [283](../tactical/283-companion-update-recovery-guidance.md) adds
component-specific recovery links and plain connection guidance in the
packaged extension, preserving attach-only retries and existing discovery/
pairing authority. The local source/render checkpoint remains separate from
actual store delivery and installed mixed-version acceptance under259. The
new production payload supersedes the prior source13dde build and source03e
extension upload proposals for final qualification; historical evidence stays
bound to its own bytes. No new build/store publication occurs.

Tactical [281](../tactical/281-managed-package-update-status.md) locally
repairs the actual MSI About-screen automatic-update contradiction. MSI/DEB/RPM
and unknown packages start and stay in existing manual package guidance, own
no check timers, and show no in-app check/install or automatic-check privacy
copy. Host policy, trust/routes and preference behavior remain unchanged.
Full web typecheck/478 tests (two existing skips),20 focused bundled-Chromium
render/accessibility cases and16 inspected managed/theme/width captures pass.
The exact original-signed a7 MSI now passes actual native About & updates
checks, tray Quit/reopen and independent cabinet/installed-byte reconciliation
under259. Initial and reopened screens both show manual guidance without
automatic-update controls. Independent100-registry/nine-file restoration,
owned cleanup, VM-off and claim-release pass. Earlier harness failures remain
recorded; installer wizard, historical MSI migration, associations and complete
installed acceptance remain separate. Renderer fixtures and source8c captures
retain their original scope.

Tactical [280](../tactical/280-desktop-executable-display-brand.md) locally
corrects the desktop output to `jstorrent-client`, preventing the observed
advanced-firewall filename from retaining the old display brand. The distinct
name preserves released old-writer process detection. All41 Node/23 native
distribution/85 Rust cases, clippy/fmt/workflow lint and the actual unsigned
Mac bundle/inventory pass. Identifiers, host, profiles, networking and updater
trust/routes remain intact. Fresh signed Windows system-label, migration and
updater evidence remains required under259; source8c receipts are unchanged.

Tactical [278](../tactical/278-android-shutdown-window-lifecycle.md) follows a
real code26 managed menu failure: the engine joins successfully, but the bound
activity still displays Live. The next local candidate27 routes Shutdown
through the activity owner, requesting the existing terminal stop then removing
the task so its binding is released. Engine/network/background/privacy policy
is unchanged. At application source68e247ad, all122 release JVM cases/lint,
original-key APK/AAB and independent package checks pass. Actual physical
isolated normal-menu Shutdown removes the task/service with joined successful
cleanup; normal launch restores a fresh Live service, the same complete row,
independent payload hash and SAF registry. Exact owned cleanup passes, with
managed code26 installation metadata unchanged. Code27 internal delivery and
revised-source hosted CI remain separate unperformed steps.

Topic: `client-surfaces`

Tactical [269](../tactical/269-android-incoming-peer-diagnostic-evidence.md)
is complete locally at application sourceaeaa72f9:15 Android Rust cases/clippy,
normal original-key dual-ABI packaging,122 JVM cases/lint and actual bounded
physical incoming snapshots pass. Full workspace1575 cases/fmt/clippy and
web typecheck/470 cases also pass, with existing ignores/skips retained.
The original failed probe observes zero then one native registration and two
UnknownTorrent rejections for exactly its owned hash; it started before actual
admission. Tactical270 is complete locally: fresh UID/exact-fixture registry
readiness precedes independent upload. Both current-source original large
fixtures verify/upload all28 MiB with120 empty files, retained diagnostic
history/actual filters, joined shutdown and actual reopened Live/owned row,
unchanged SAF registry/payload and cleanup. Readiness takes107.99/166.16 seconds.
The original48 portable cases pass; earlier failed receipts remain scoped and intact.
Normal diagnostic warnings intentionally remain across category filters. No
engine/network/admission/retry policy changes. Default three-repetition/hour
and managed delivery remain open under259; a short pass is not an hour.

Tactical272 keeps the measured28-MiB upload's120-second allowance and scales
the40-MiB hourly fixture to172 seconds, below the existing300-second helper
bound. Native admission still has180 seconds; independent file hashes and
joined cleanup remain mandatory. All51 qualification/five transport cases
pass. Cohort A now passes the whole default source-aeaa run: three cold
repetitions, 3,600-second detached observation, independent full 40-MiB
download/upload, retained filters, joined actual Live reopen, SAF continuity
and cleanup. Its loaded driver matches source09342f73 and retains the fixed
120-second allowance; newer harness changes are not attributed to it. All
seven current-APK SAF/source recovery cases also pass with independent
hashes and cleanup. B's first proportional full run passes its
hour/download/upload/filter components but fails fresh reopen while ARC is
stopped/sleeping; failure/cleanup stay intact. Tactical 273 completes
locally: all 54 portable/five transport cases and the 28-MiB targeted native
wake pass. The fresh full B default repeat also passes all three cold
repetitions, the hour, full 40-MiB hashes, filters, clean joined shutdown,
native wake followed by fresh actual Live/owned row, unchanged SAF and
cleanup. Native readiness is observed at 168.45 seconds; independent upload
uses a 172-second allowance and its full verification call takes 159.35
seconds. Zero XML captures are unavailable and two observed Back actions
suffice. Exact staging/ marker cleanup passes with production metadata
unchanged before/after. Tacticals 272/273 complete bounded scopes;
managed/provider/reboot/network/sleep acceptance remains open.

Both source0aa physical cohorts independently hash the installed APK and pass
small foreground/background/reopened upload plus joined Live-library restart,
retained SAF registry and cleanup. This closes Tactical260's bounded local
shutdown evidence, not the failed large-metadata/hour or managed delivery gates.
Tactical266's restored native retained history/Live-library component also passes
both cohorts. Whole upload receipts remain failed; severity/category button
changes alone cannot prove asynchronous filtering. Tactical267 now checks actual
visible filtered rows, with26 passing portable driver cases.

Tactical [268](../tactical/268-android-visible-error-fallback.md) replaces
message-less/blank Android exception class-name fallbacks with catalog-owned
product copy. Meaningful messages and complete technical logs remain. Portable
formatting regression, 122 debug JVM cases, lint and all localization catalogs
pass; normal original-signed packaging and independent package checks also
pass. Latest-source physical delivery remains separately pending.
This is a source-level leak prevention, not a reproduced runtime exception.

Tactical [266](../tactical/266-android-diagnostic-history-resynchronization.md)
repairs Android's diagnostic-only queue after a real 581,079-byte history cannot
resynchronize through 256 KiB. Source `2adf2eb1` requests the existing 4-MiB
subscription bound for retained history (2 MiB / 2,048 events); Kotlin still
retains 512 rows. The real retention regression rejects the old budget, delivers
473,255 bytes and resynchronizes unchanged history. Normal original-signed and
isolated dual-ABI builds, 121 release JVM cases, lint and independent package
checks pass. Full session checks pass 387 cases with two existing ignores.
Bounded physical retained-history/Live return passes; large-fixture upload
and managed delivery remain open under259/267. No store upload occurs.

Tactical [267](../tactical/267-physical-upload-and-reopen-evidence.md) strengthens
actual upload transport/readiness/counter and observed retained-settings
navigation evidence. Both source-376 physical runs pass their full 3,600-second
background transfer and whole 40-MiB hash; their subsequent upload phase fails.
No complete end-to-end pass is inferred. Portable delayed-listener/failure
ownership/refusal tests pass; short current-APK trials run before full retries.
No engine/network/seeding policy changes or inherited app/data cleanup occurs.

Tactical [262](../tactical/262-android-network-status-presentation.md) removes
actual Android Network Settings class-name leaks through exhaustive localized
listener/router descriptions, retaining endpoints, ports, failure and uncertain
lease facts. Message-less feedback failures use product copy. Actual owned
API-35 before/after captures and all 24 navigation cases pass, including the new
status regression. Internal namespaces, generated ABI and network policy remain
unchanged. Original-key production release from `37673687` passes 121 JVM
cases, lint and independent APK/AAB checks; its actual production APK also
passes the corrected native screen capture. Source-184's Android capsule is
superseded. Store/physical delivery gates remain Tactical 259.

Tactical [260](../tactical/260-android-shutdown-failure-containment.md) contains
an observed physical Android shutdown exception at the client adapter boundary.
Typed native cleanup errors remain visible after releasing the client; other
failures and cancellation propagate. Both ABI builds, generated Kotlin and
121 JVM tests pass. Physical shutdown/restart and endurance remain pending;
engine, mapping leases and background policy are unchanged.

Tactical [258](../tactical/258-cross-surface-branding-and-design-audit.md)
completes a cross-surface JSTorrent branding audit. Native Android and iOS headers
use the original box; iOS app/permission/catalog labels and AppIcon now match
JSTorrent. Compiled phone/iPad and API-35 Android evidence, a validated macOS
JSTorrent Preview bundle, shared React/extension rendering and source-only
Windows/Linux limits are retained in the
[audit execution record](../tactical/258-cross-surface-branding-and-design-audit.md). No engine owner,
platform identity, persistence, updater trust or store route changes. The iOS
runtime card, native onboarding hierarchy and current store screenshot campaign
remain explicit design follow-ups.

Tactical 253 now makes `http://jstorrent.localhost:3030` the primary Linux
browser route. Its dedicated loopback name bypasses ChromeOS Linux DNS
registration and keeps host-only cookies separate from bare localhost apps.
Exact Host/Origin, extension handoff, optional permission and service identity
checks remain. Both physical cohorts pass actual browser download, independent
hash verification, source-offline process restart and tab reuse; cohort B also
passes the installed launcher and real permission prompt. Cohort A uses an
isolated runtime alongside its preserved installation. The old hostname route
requires updating the Linux package and extension together; it is not an
automatic fallback. These unsigned candidates do not qualify store delivery,
ARM hardware, full-device suspend/reboot or forwarding endurance.

Tactical 253's interruption follow-up preserves saved Android pairing after
transport, connection-close and resource-limit handshake failures. Only an
explicit `authentication_failed` response for a saved credential starts fresh
approval; a rejected newly approved credential does not create another approval
loop. Five focused cases, the 470-test web suite and extension packaging pass.
The actual packaged extension also passes physical Android process restart,
simulated page-owned socket interruption, worker stop/wake and real picker
expiration followed by completed selection. Saved pairing is retained without
new approval. These browser cases use an empty isolated library; native payload
recovery is separately recorded. The initial localhost-marker proposal is superseded by the primary dedicated
localhost route and physical product evidence above.

Tactical 253's portable recovery checkpoint passes bounded Android discovery,
manual recovery, detached-view cleanup, offline troubleshooting and explicit
Linux guidance in the packaged extension. Host-built isolated candidates add
cohort-A Android and Linux-runtime byte checks/repetitions, real Android
pairing/manual recovery and extension file-input evidence. Both hosts finish
controlled 60-minute byte-verified observations on cohort A; native actual
Remove/keep and detached-view completion pass bounded checks. Final approval
expiry/cancellation and foreground unavailable-service guidance pass without
inferring Play, app presence or policy. The follow-up proves normal Terminal
startup restores missing Linux hostname/container registration. The current
isolated Linux browser connects, verifies real file-picker intake and retains
the completed row/bytes after VM restart with the source offline. Its offline
connection page offers exact-host optional access, bounded checks and manual
recovery; fresh document navigation avoids retained old HTML cache. Current
signed installation/registered candidate Launcher and full physical/store
acceptance remain open. Cohort A retains
legacy/debug apps. Cohort B is now reachable: its inherited Play app is legacy,
while isolated Android/extension pairing, real folder/file picker cancellation,
keep-data removal and corrected browser completion pass. Completed-library
startup was slow with temporary unavailable-root presentation; the subsequent
four-observation/checking-state repair reduces the 121-file case to 11–11.5
seconds and removes that false presentation. Fresh Linux
setup and signed public installation work, but the registered launcher's browser
handoff was blocked by ChromeOS hostname registration, even after ordinary
VM recovery, before the dedicated-localhost update above. Both full-hour controlled observations verify their bytes; Linux
retains its original runtime-only limit; the new bounded route checks are
recorded separately above. The local screenshot/HTML review retains exact
candidate limits and the remaining startup/store/lifecycle gaps.
Neither injected presentation nor appliance health qualifies Play installation.

Priority accepted 2026-10-01: qualify ChromeOS onboarding and recovery on both
available physical Chromebooks, starting with Play not enabled or Android
installation failing. Tactical
[253](../tactical/253-chromeos-onboarding-recovery-and-physical-qualification.md)
owns pre-connection troubleshooting, explicit Linux fallback and bounded
end-to-end hardware repetitions. Existing implemented Android/Crostini paths
are foundations, not evidence that these customer journeys pass.

Tactical [251](../tactical/251-jstorrent-ci-candidates-and-installed-update.md)
completes a bounded production-identity CI attempt without publication. Windows
and both Linux package lanes pass; Android passes building/tests/lint then fails
its original-certificate gate. Fresh macOS notarization needs the team agreement
resolved. Ordinary CI passes every executed job. The initial updater
secret fails JSTorrent's original trust root; signed installed continuity remains
open. An exact old macOS app checks its unchanged production route successfully.
No product presentation, application DTO or engine behavior changes in this slice.
The supplied original key is now provisioned and fresh CI nonce signing passes
with the unchanged password. Eight available Windows/Linux package signatures
now independently verify against the original root; complete-matrix and installed
update gates remain open.

Tactical [250](../tactical/250-jstorrent-production-identity-candidates.md)
prepares production desktop/Android/extension identities and public trust
configuration. Desktop has an explicit candidate overlay, Android release is
`com.jstorrent.app`, and `package:jstorrent` selects the original extension ID.
Normal debug builds stay isolated. Desktop updater routing and production
extension-origin admission are corrected; Android keeps its existing exact
origin boundary. No view DTO, generated contract or Compose presentation change
is introduced. [Full signed/installed cutover](../jstorrent-cutover-checklist.md)
remains unqualified.

Tactical [249](../tactical/249-jstorrent-brand-and-extension-refresh.md) starts
production branding: shared React/desktop window and Android presentation use
JSTorrent; original desktop/tray, Android adaptive/launcher/store and extension
icons are restored with exact MIT provenance and packaged notices. The extension
popup and connection screen are refreshed. Desktop incubation bundle names,
Android test/incubation IDs and the extension incubation Web Store key remain;
this does not qualify production identity, signing, launch or store continuity.
iOS and website branding are outside this three-surface slice.


Tactical [248](../tactical/248-chromeos-staggered-upgrade.md) adds terminal
Android-update and extension-update guidance to the packaged companion page,
manual Retry and a Google Play action. Current compatible service discovery
wins; old status discovery carries no credentials or legacy commands. Imported
ChromeOS Compose libraries explain standalone use and updating/re-pairing the
extension. Controlled API 28/35 released-extension writers cross an installed
Android replacement into the same successor owner, with fresh pairing/control.
This does not qualify production store identities or physical ARC replacement.

Tactical [246](../tactical/246-android-legacy-import-and-installed-upgrade.md)
implements Android legacy migration before the native application opens.
Unmetered, lifecycle, wake and selection preferences use existing product
semantics; unsupported settings are dropped. Incubation identities remain
separate; only the same-package production identity runs migration, with an
explicit debug-only package override for emulator qualification.

Tactical [245](../tactical/245-android-legacy-inventory-and-import-contract.md)
completes the pinned Android legacy inventory/format checkpoint and scopes its
importer and same-package upgrade matrix. Thirteen generated cases and ten
Python tests pass; no Android package, production key, grants or UI were
changed. The importer and installed/Play replacement remain open.

Tactical [240](../tactical/240-signed-desktop-control-qualification.md) completes
signed current-source delivery with [Latest 0.2.801](../evidence/desktop-latest-v0.2.801.md).
Exact-source CI, five signed package lanes, public signatures/checksums and both
macOS notarized/stapled DMGs pass. Claimed macOS arm64 and Windows/Linux x64
installations pass native 701-to-801 updating, signed/registered helper checks,
background control, shared views, fresh browser-closed verified transfers,
picker cleanup, explicit/passive relaunch and bounded registration repair.
The Mac also installs the exact public DMG and recreates its bundled host.
Physical sleep/wake, interrupted updates, broader endurance, Intel/minimum-macOS
installed coverage and production graduation remain open. Tactical 241
implements atomic local import; [242](../tactical/242-legacy-desktop-handoff-rehearsal.md)
adds production-only old-host fencing and a bounded installed macOS replacement
checkpoint with generated state. [243](../tactical/243-windows-linux-legacy-replacement.md)
adds installed Windows NSIS/Linux AppImage checkpoints and repairs Windows
snapshot syncing. [244](../tactical/244-unavailable-storage-presentation.md)
corrects shared React blocked-storage labels and Needs attention membership
with deterministic evidence. Signed production delivery,
privacy/support continuity and full branding remain open.

240 also fixes the macOS CFT support path to `Google/Chrome for Testing`.
Its actual default-profile discovery/repair evidence supersedes the misspelled
configured test root in 232. The app bundles the native host and installs a
private per-user copy; no separate user-managed helper installer is needed.

Selected three-platform beta replacement, rollback and native registration
repair pass in [236](../tactical/236-desktop-compatibility-refusal-and-recovery.md)
and [237](../tactical/237-macos-windows-package-recovery.md).
[238](../tactical/238-signed-desktop-channel-recovery.md) now proves native signed
0.2.301 → 0.2.501 updating and return-to-Stable without downgrade on all three
platforms; that published cohort predates extension control.
[239](../tactical/239-desktop-suspension-browser-recovery.md) proves same-runtime
browser restart, independently verified 32-MiB completion and Quit without
passive resurrection on all three, plus macOS VM suspend/resume. Linux's earlier
lock blocker is superseded by authorized VM recreation with verified stored
credentials. Its attempted native suspend-to-idle did not recover and required
a supported forced stop; native sleep/wake remains unqualified. Owned test state
is removed and claims released. 240 supplies signed current-source delivery.
Next: bounded interrupted-update, physical sleep/wake and broader endurance
evidence. Importer implementation and three-platform handoff checkpoints are
recorded in 241/242/243; production qualification remains separate.

Tactical [`236`](../tactical/236-desktop-compatibility-refusal-and-recovery.md)
adds clear terminal desktop compatibility errors and attach-only Retry
connection. Its installed Linux beta old/new extension/runtime combinations,
open-page replacement, credential rotation, bounded registration repair and
same-schema rollback preserve the controlled library. The macOS/Windows beta
matrices now pass in 237. 240 supplies signed current-source delivery; original
legacy browser-store pairs remain open. 243 adds the bounded Windows/Linux
installed legacy migration checkpoint.

Tactical [`235`](../tactical/235-linux-quit-launch-handoff.md) repairs the Linux
Quit/launch overlap. A stopping owner returns Retry; the explicit launch process
retains its arguments and waits within a bounded deadline before claiming the
vacated singleton name. Passive activity never creates that launcher. Installed
tray-Quit, native/background launch, actual magnet/file associations and a
12-launch race pass. macOS/Windows retain their existing plugin; old Linux
binaries retain the old race. Update compatibility remains a separate gate.

Tactical [`234`](../tactical/234-desktop-user-intent-and-background-lifecycle.md)
owns the accepted desktop lifetime follow-up: retain the tray/status-bar icon
while the runtime runs, including idle/paused states; browser closure only
detaches. Fresh toolbar, Start, or OS torrent-input intent may relaunch after
Quit; page restoration, worker wake and retries only attach. Tray Open and
OS magnet/file delivery always use the native window. No preferred surface,
browser-profile routing, icon-hiding or automatic completion shutdown is added.
Installed macOS/Windows/Linux debug builds pass the bounded browser-close,
64 reload/worker-stop, discard and explicit/passive relaunch checkpoint.
Desktop disconnect retires abandoned client views without disturbing native
views. Broader endurance and installer/update compatibility remain open.
Its macOS magnet regression found a Tauri plugin-lock reentry. URL intake now
runs in the application Opened callback, after plugin dispatch, so a
background owner can create its first native window without deadlocking.

Tactical [`232`](../tactical/232-desktop-extension-control.md) implements the
first desktop beta-extension client using the packaged shared React application.
Native and extension views share one default library. Explicit extension open
starts the runtime without creating a native window; ordinary desktop launch
shows that window. Authenticated extension requests open a desktop-owned native
picker on Linux, Windows and macOS; disconnect and Quit reap its helper. macOS
completes AppKit accessory launch before panel activation and routes the
application menu's Cmd-Q through the same joined shutdown as tray Quit.
Installed unsigned debug-package, controlled transfer and lifecycle checkpoints
pass on all three platforms. Media, updater and shell actions remain native;
broader browser endurance, update compatibility and production readiness remain
separate gates recorded in the tactical.

Tactical [`229`](../tactical/229-web-desktop-data-reset.md) brings the reset
and clear choices to shared React Settings for local browser and desktop
clients. React owns confirmation and awaits the existing torrent-removal jobs;
the session, desktop shell, access, privacy, and browser owners clear their own
state before the client reloads. Remote clients and demo scenarios cannot clear
the host profile.

Tactical [`230`](../tactical/230-desktop-stable-latest-update-channels.md)
adds desktop Stable/Latest source wiring. The native desktop app owns the
saved selection and signed candidate; shared React exposes the choice only
for app, NSIS, and AppImage installations. The signed five-target Latest
release and production update routes pass; 238 qualifies installed channel
selection and 240 qualifies signed current-source desktop control. Android,
iOS, headless, and Crostini retain their existing distribution policies.

Completed local Tactical
[`216`](../tactical/216-local-support-diagnostics-and-release-baseline.md)
adds frozen-preview local diagnostics copy/download to desktop/headless About,
with bounded allowlisted build/update facts and no raw errors, logs, paths or
identifiers. Four phone/wide light/dark browser cases pass exact byte and
accessibility checks locally and in both hosted 43-test browser runs. Native Android/iOS export remains a separate presentation
decision; no application API or runtime semantics change.

Completed local and hosted Tactical
[`213`](../tactical/213-owned-android-runtime-ci.md) promotes the real Android
SAF selection/restart/recheck/removal cohort into an owned API 35 emulator CI
gate. Phone evidence exposed and repairs clipped confirmation buttons and
incorrect selection-limit errors; a resumed-activity fence repairs the
harness's picker handoff. Two ARM64 runs pass with 3/40 storage handles and
complete emulator/AVD cleanup. Hosted runs `34682523287` and `34684328524`
now pass the API 35 x86_64 cohort with the same 3/40 handle peak, exact removal
and owned-AVD cleanup. See the
[exact hosted record](../evidence/release-readiness-ci-2026-09-12.md).

Status: Direct-storage presentation replacement completed on 2026-08-29 by
Tactical [`191`](../tactical/191-direct-filesystem-storage.md). It removes
publication and managed-storage jargon from React/Tauri, Compose, and SwiftUI,
and makes a completed wanted file usable without another selected file's
completion. The following surface history remains as an implementation record.

Completed Tactical
[`193`](../tactical/193-stateless-foreground-downloader.md) adds the separate
native `rstorrent-download` foreground process. Its strict argument grammar,
bounded human progress, and terminal summary form a finite command surface,
not a generated application API, daemon, TUI, or alternate product UI. It
causes no React, Tauri, Compose, SwiftUI, Android CLI, or iOS CLI change.

Tactical [`194`](../tactical/194-chromeos-android-extension-control.md)
implements the
first migration-critical JSTorrent Android parity slice. On ChromeOS, the
existing Android foreground service remains the sole Rust application,
engine, profile, and SAF owner while the beta extension packages the shared
React UI as a detachable authenticated client. The same React folder
action used by Crostini delegates to Android's SAF picker; a new current root
does not discard grants required by older torrents. It does not recreate
JSTorrent's extension-owned engine/raw IO daemon. Deterministic, Android,
retained-root/coexistence/detached-transfer, exact ARC binding, and physical
same-LAN rejection gates pass.

Completed Tactical
[`190`](../tactical/190-opaque-wasm-relay-foundation.md) adds no selectable
product surface. Its tested proof-only browser transport composes the existing
`WebSocketApplicationViewClient` above the shared Wasm OPAQUE/record core,
withholds socket-open until authenticated host readiness, and explicitly
rejects torrent byte upload and remote media capability calls. A real Chrome
trace matches the direct reducer exactly. Completed Tactical
[`192`](../tactical/192-production-owner-relay-access.md) implements a release-built
remote-only React capability profile, private/shared-browser login choice,
automatic resume and complete authorization/circuit security UX only in an
explicit loopback validation composition. Publication and support remain later.

The first-party product is implemented across a browser-hosted web view, a
Tauri desktop webview, Android Compose, and the maintained iOS SwiftUI client.
The same mature browser client is also packaged by completed Tactical `170`
for one configured Linux headless service. Completed Tactical `174` attaches
that one application owner to an exact LAN gateway and an exact loopback
gateway behind Tailscale Serve without adding a second host process.
Completed
Tactical
[`143`](../tactical/143-dual-identity-and-persistence-foundation.md) makes
React, Tauri, media, Compose, and Android service routing use canonical opaque
torrent IDs while explicit v1 hashes remain available for display and export.
Completed Tactical
[`151`](../tactical/151-complete-source-pure-v2-runtime-vertical.md) admits
strict complete-source pure-v2 `.torrent` files through the same Add,
selection, progress, Files, Force recheck, export, restart, and seeding
surfaces. Clients gain no format-specific workflow or storage policy.
Completed Tactical
[`155`](../tactical/155-v2-magnet-authenticated-hash-exchange.md) sends
pure-v2 `btmh` magnets through that same Add, BEP 53 selection, progress,
Files, export, restart, promotion, removal, and seeding surface. Protocol and
Merkle policy remain in the in-process engine; clients gain no hash-specific
controls. Completed Tactical
[`156`](../tactical/156-hybrid-dual-swarm-runtime-closure.md) sends complete or
single-/dual-topic hybrid input through that same one-row workflow. Both exact
identities remain visible/exportable while selection, promotion, progress,
Files, restart, recheck, seeding, and removal remain format-neutral. The
production browser and Android API 34 SAF profiles pass; Tauri builds and the
unsigned iOS archive require no presentation fork or hybrid control. The
Android foreground app now uses durable SAF storage without
placing platform capabilities in the portable UI command contract. The
one-command desktop launcher is smoke-tested on Apple silicon macOS as well as
the original Linux development host. Closing its macOS window detaches that
view while Dock activation recreates and focuses it without restarting the
application service. Tactical `012` completed isolated headless Chrome and
no-window Android AVD harnesses plus equivalent bounded diagnostics and
progress explanations on the shared web and Android Compose surfaces.
Tactical `013` made desktop and Android select online torrent networking while
the browser gateway and presentation harnesses explicitly remain
loopback-only. The accepted
[`desktop-inspection-surface`](desktop-inspection-surface.md) direction now
allows desktop/web and Android presentation to diverge: desktop/web becomes a
dense JSTorrent-derived inspection surface, while Android remains a separate
platform-appropriate product without automatic tab or diagnostic parity. The
fresh React, CSS Modules, adaptive navigation, touch, and accessibility
direction for that shared presentation lives in
[`web-ui-design.md`](web-ui-design.md). Tactical `033` now supplies its bounded
generated TypeScript/schema boundary, authenticated polling client, pure
reducer, and lifecycle controller. Tactical `034` adds the new responsive
React inspection application behind an explicit demo route without replacing
the live browser/Tauri entry or changing Android. Tactical `035` connects that
application to live torrent and active-peer views, including semantic
responsive view selection and recovery after a suspended tab outlives its
Rust view-set lease. The live path is proven through the headless browser
gateway; Android remains intentionally unchanged.
Tactical `084` splits the shared React Settings dialog into focused
appearance, download, and connection/seeding sections. Browser-hosted and
Tauri clients now share one atomic persisted loopback-listener/global-peer/
upload-slot form and authoritative active/effective/bind status; Android
receives the generated contract; Tactical `117` now presents these backed
settings in Compose.
Tactical [`111`](../tactical/111-mse-peer-stream-encryption.md)'s implemented
slice adds the generated four-value MSE/PE policy and live effective state to
that same contract. Browser and Tauri share the labelled non-security control
and the truthful encrypted-or-obfuscated peer flag; Android carries and
compiles the enum/default, exposes bounded DH-owner evidence to the retained
product harness. Tactical `117` now presents the backed encryption setting and
exact peer detail. The named
API 37 physical Pixel 7a profile applied `required`, completed five forced-RC4
oracle sessions, published the exact payload, drained the DH owner, and cleaned
up within the recorded descriptor and storage bounds.
Completed follow-up Tactical
[`115`](../tactical/115-mse-policy-advertisement-and-peer-detail.md) carries
the optional exact MSE method through the shared generated contract. The
browser/Tauri peer table uses it only in the existing `E` cell's tooltip and
accessible name. Android receives the additive binding but still gains no
Compose settings or peer-detail work.
Completed Tactical
[`112`](../tactical/112-dual-stack-transport-and-ipv6-dht.md) adds one
default-enabled IPv6 control and configured/effective/application state to the
same generated settings contract. Browser and Tauri share the control and
typed degradation presentation. Android compiles and persists the value and
its retained product harness proves policy/restart behavior on the API 34 AVD
and named API 37 Pixel 7a. Tactical `117` now presents the backed IPv6 setting
and renders both DHT families within one bounded Compose view rather than
adding a second page or client-owned inference.
Completed Tactical
[`205`](../tactical/205-durable-dht-and-pex-controls.md) adds default-on DHT and
peer-exchange switches to the same Connection & seeding / Network settings
contract in React and Compose. Both surfaces show configured intent plus live
application/effective truth and state that private torrents never participate;
generated Swift carries the same fields without inventing a separate iOS
settings owner.
Completed Tactical
[`114`](../tactical/114-session-wide-concurrent-torrent-admission.md) adds
authoritative operational state and queue position to shared torrent rows,
configured/effective active-download limits and clamp state to Settings, and
Move to top/Move to bottom actions to Transfers. Headless Chrome proves those
settings and actions through the generated contract. Android consumes the
same additive contract and a physical Pixel 7a proves configured three/
effective two plus promotion. Tactical `117` now exposes the same queue and
active-download controls in Compose.
Maintainer direction on 2026-08-09 accepted iOS as a first-party in-process
product. Completed Tactical
[`116`](../tactical/116-platform-storage-coherence-and-ios-feasibility.md)
adds the historical physical-device feasibility harness around the real Rust
storage and direct-networking seams. Explicit direction on 2026-08-13 then
completed Tacticals `147`--`149`, adding the fourth supported surface with
generated Swift bindings, qualified external folders, direct first-party
JSTorrent SwiftUI reuse, and physical lifecycle evidence.
Completed Tactical
[`117`](../tactical/117-jstorrent-shaped-android-product-ui.md) supplies the
first UI-complete Android product for the current application boundary. Its
single-stack Material 3 Library, six-tab torrent detail, Speed, dual-family
DHT, structured Logs, and Settings hierarchy deliberately follow JSTorrent
Android standalone with JSTorrent branding and honest capability gaps.
Completed Tactical
[`172`](../tactical/172-provisional-magnet-display-name.md) gives the shared
web, Android, iOS, and desktop-notification presentation boundary one
consistent torrent-name order: verified metainfo name, bounded provisional
magnet `dn`, then the surface's existing opaque fallback. Android file-open
and all other path-authority behavior continue to require the verified name;
the full retained magnet never crosses the application view boundary.
Active Tactical
[`113`](../tactical/113-ipv6-firewall-pinhole-and-incoming-reachability.md)
adds no setting. Browser and Tauri render the existing IPv4 mapping status and
the sibling IPv6 firewall-pinhole status independently, including service
absence, gateway-reported unfiltered state, finite lease, renewal, and cleanup
failure. Product wording says that an accepted pinhole is gateway evidence,
not an observed incoming peer. Android receives the additive generated binding
and passes both native ABI builds, UniFFI/Kotlin regeneration, `assembleDebug`,
and `testDebugUnitTest`, but deliberately gains no Compose surface or physical
pinhole gate.

Completed Tactical
[`098`](../tactical/098-authenticated-https-tracker-platform-trust.md) adds a
default-secure tracker HTTPS field to that same contract without rendering an
ordinary React or Compose control. The React draft, equality, refresh, and
save paths preserve the hidden authoritative value. Advanced consumers can
use the generated typed command; tracker rows render authenticated versus
explicitly unauthenticated encryption without a client-side inference.
Tactical `036` introduced the production-built browser path behind
`./scripts/webui`. Tactical `109` now gives it one fixed same-origin gateway:
the root URL remains stable across restarts, the gateway serves both the UI
and application transport, and the terminal owns one joined child process.
Tactical [`226`](../tactical/226-live-webui-hot-reload.md) adds an optional
`--reload` workflow at that same browser URL. Vite hot reloads React/CSS and
proxies API, WebSocket, health, and media requests to a private loopback
gateway with the same persistent profile and native folder picker. The
ordinary launcher still serves the production bundle.
It retains isolated persistent state, default online networking, and normal
browser opening. Tactical `076`
adds an explicit same-origin production build for one Basic-authenticated
private maintainer host, including phone-sized browser access, without making
remote hosting a general product capability. Tactical `048`
selects the React inspection application for Tauri and supplies it with the
same leased view-set semantics over acknowledged in-process Channel delivery;
the desktop opens no loopback server. Tactical `037` adds the first live
mutation to the new surface: bounded magnet intake through the semantic
command boundary. Tactical `038`
adds five curated public test-torrent shortcuts without adding a debug host
command or bypassing application policy. Android remains intentionally
unchanged. Tactical `071` adds a local selection-aware canonical magnet copy
action. Tactical `107` replaces its presentation-only hash construction with
a typed read-only application export used by browser and Tauri while keeping
Android presentation unchanged. Tactical `049` replaces the React product's
generic Logs table with the structured ordered console through both browser
polling and Tauri Channel delivery. Shared generated Rust/TypeScript/Kotlin
semantic artifacts continue to compile, but Android presentation intentionally
does not mirror this dense desktop diagnostic surface.
Tactical `085` gives the shared browser/Tauri product one grouped action model
for toolbar, More, and actionable-row context menus, including coordinated
multi-torrent removal and multi-file priority changes. Android receives and
compiles the projected recheck-capability field but intentionally gains no
desktop context-menu presentation.
Completed Tactical
[`176`](../tactical/176-durable-high-file-priority.md) carries
High/Normal/Skip through the shared generated contract. React/Tauri exposes
the three values through its existing grouped file actions, Android Compose
replaces the binary checkbox with a three-value menu, and iOS SwiftUI displays
and sets the same values. This presentation does not add a second scheduler or
progressive Android/iOS playback.
Tactical
[`317`](../tactical/317-android-files-tab-rows-and-multiselect.md) replaces
that Android menu and its three-band rows with compact file rows, an actions
sheet whose priority is an explicit Skip/Normal/High segmented control, and
multi-file selection that follows the Library's long-press mechanics and
sends one bounded batch command per action. Selection is scoped to the
presented catalog page; folder grouping remains absent.
Completed Tactical
[`072`](../tactical/072-derived-media-catalog.md) adds a media-first torrent
detail to the shared React browser/Tauri presentation. It leases a generated
derived video/episode projection independently from the existing paged Files
view and retains exact shared file progress, priority, and availability.
Android and iOS compile and exhaustively reduce the additive generated
contract, but gain no Compose or SwiftUI presentation; thumbnails and playback
remain separate cross-platform product decisions.
Completed Tactical
[`189`](../tactical/189-library-playback-and-torrent-size.md) makes the shared
React Media glyph an accessible Play control for the already typed `available`
and `streamable` rows. Browser keeps the existing opener-isolated tab and Tauri
keeps its system opener behind the same `open_file` action. The same slice
carries exact metadata-backed torrent total size through the generated summary
contract and all first-party reducers so Library, Transfers, and Workbench no
longer invent pending size after geometry exists. Android and iOS receive no
new playback presentation, and no embedded player is implied.

Tactical `081` adds adapter-level v1 `.torrent` byte intake through
the ordinary browser WebSocket and raw in-process Tauri IPC, plus HTTP
automation. The raw
attachment maximum is 64 MiB while text/JSON remains 64 KiB; file and tracker
inspection move to bounded pages so larger accepted catalogs do not inflate
one view snapshot. Tactical `083` adds the shared presentation: empty Add
opens one advisory single-file chooser in browser and Tauri, reuses the
existing root/start dialog, retains only the `File` while options are pending,
and submits one bounded `ArrayBuffer` through the active adapter. Nonempty Add
remains the magnet path; there is no client digest, upload percentage, path,
or alternate native picker command.

Completed Tactical
[`134`](../tactical/134-hierarchical-transfer-rate-enforcement.md) makes All
torrents upload/download limits and per-torrent upload/download limits
operable in both first-party product families. Browser/Tauri uses Connection
& seeding settings plus General torrent detail; Compose uses Speed &
Connection Limits plus torrent detail. Both present semantic Unlimited and
KiB/s finite values without inferring effective session state. Headless Chrome
proves wide, compact, phone, keyboard, retained-value, save, and accessibility
behavior; the API 34 no-window AVD proves durable limited concurrent transfer
through the Android product boundary.

Completed Tactical
[`180`](../tactical/180-typed-settings-patches-and-draft-convergence.md)
replaces those mutation shapes with independent typed resource patches and
revision-aware drafts. Browser/Tauri and both Android Compose editors preserve
dirty, submitted, failed, and conflicting fields under complete cloned
updates and resets; clean fields continue to follow authority. Android owns
requests in its existing service/state boundary. iOS gains the generated
patch command boundary but no invented settings presentation because none
currently exists.

Completed Tactical
[`138`](../tactical/138-verified-http-file-serving.md) adds one `Open` action
to eligible rows in the shared React Files table. Browser hosting reserves an
opener-isolated tab before the asynchronous capability call; Tauri validates
the returned URL against its current exact-loopback media origin before using
the system opener. Failure closes the reserved tab and remains typed
presentation state. Android deliberately retains its existing complete-file
`content://` action and starts no HTTP listener. There is no embedded player,
copy-link action, or MIME-specific UI.
Completed Tactical
[`139`](../tactical/139-incomplete-file-streaming-demand.md) extends the same
React/Tauri `Open` action to typed `streamable` rows. Browser and Tauri retain
their existing opener, origin-validation, failure, and lifecycle behavior;
the progressive wait and scheduling stay behind the capability URL. Android
continues to present only completed-file native open and gains no listener or
streaming presentation.

## Scope

This topic owns the client side of each surface above the shared application
service: the reusable web application, desktop shell, Android presentation
adapter, generated client types, and the boundary between presentation and
application control.

It does not own torrent protocol behavior, payload storage, the future remote
account or relay system, or the HTTP payload-serving implementation.

## Accepted Product Shape

RSTorrent has three initial user-interface surfaces:

- a browser-hosted web application capable of using an authenticated remote
  control transport;
- a Tauri desktop application embedding the same web application; and
- an Android Compose application adapted from the existing JSTorrent Android
  product.

The maintained iOS 16+ app is a first-party SwiftUI product using the same
in-process Rust engine and typed application semantics. Completed Tactical
`147` supplies generated Swift UniFFI, durable app-owned and qualified selected
roots, and a coordinated descriptor-release seam. Completed Tactical `148`
directly reuses the first-party JSTorrent iOS views/assets/localizations while
replacing its JavaScriptCore controller and omitting Search. Completed Tactical
`149` owns finite background, process-death recovery, cold/warm handoff, and
reproducible archives without publication. Completed Tactical `152` narrows
long-lived selected-root coordination to exact files and physically proves
controlled multifile publication plus the exact Big Buck Bunny public torrent
through Apple system playback. Completed Tactical `154` reserves 100% and
Finished for Complete/Published state and changes **Open using** from a generic
activity sheet to direct Quick Look. A physical real-swarm rerun proves one-tap
native video presentation, advancing playback, lease-backed dismissal, and
exact cleanup. Physical iPhone evidence supports the
foreground and finite-background product claim; indefinite background,
iCloud/File Provider roots, migration, and public distribution remain absent.

Desktop product content is web UI. Native desktop code is limited to the
application shell and operating-system integration such as process and window
lifecycle, tray and menus, notifications, startup, file associations, native
dialogs, deep links, and updates.

The Tauri and browser builds share components, reducers, generated TypeScript
contract types, and one transport-neutral `ApplicationClient` interface.
Their transports differ:

- Tauri uses native commands for request/response and an ordered Channel with
  explicit post-application acknowledgement for low-latency view updates.
- The browser ordinarily uses one authenticated multiplexed WebSocket for all
  semantic calls and acknowledged view updates. Bounded HTTP long polling is
  an explicitly selected loopback diagnostic comparison only; it is not a
  visible preference, automatic fallback or concurrent second lane.

The native Tauri view stays in-process. Tactical `232` explicitly adds the
bounded authenticated listener for extension clients; it does not route the
native view through that socket. Both adapt to the same semantic dispatcher
and reactive-view contract.

The graduation direction adds the existing JSTorrent extension as a possible
first-class client for a native desktop, Android, or Crostini host.
Desktop extension and Tauri clients should attach to one desktop
profile; ChromeOS Android and Crostini remain separate host and data
authorities. That future product topology, handoff UX, and manual migration
posture are recorded in
[`product-surfaces-and-migration.md`](product-surfaces-and-migration.md). It
does not qualify a production extension rollout. Tactical `232` now supplies
the first beta desktop control implementation.

Tactical
[`167`](../tactical/167-chromeos-crostini-bundled-web-launcher.md) makes one
bounded refinement for the first ChromeOS Linux product: its package serves
this same mature React application and same-origin gateway directly, while the
beta extension launches, focuses, and explains that host. This does not
foreclose an extension-hosted client later and does not change the
separate Android or desktop profile owners. The exact local x86_64 package is
implemented and passes warm, twice-stopped-VM, repeated-singleton,
detachable-transfer, uninstall/reinstall, and purge evidence on the physical
Chromebook. Full reboot remains a conditional gap because the testbed exposes
no approved ChromeOS profile-login credential; signed/public packages,
updating, and broader lifecycle claims remain separate work.

Completed Tactical
[`168`](../tactical/168-platform-aware-extension-launcher.md) makes the small
beta extension launcher platform-relevant. Desktop Chrome sees only the native
desktop bootstrap. ChromeOS sees the exact published JSTorrent Android listing
and the ChromeOS Linux open/recovery controls, plus explicit separate-library
copy; it does not claim Play or app availability. The deterministic `0.3.0`
package and physical ChromeOS chooser, Play destination, and warm Crostini
handoff pass without new permissions.

Completed Tactical
[`169`](../tactical/169-hosted-crostini-bootstrap-and-release.md) adds the
release-ready website bootstrap and strict two-architecture signed-manifest
workflow around that same bundled host-and-UI package. Its physical
x86_64 local signed fixture repairs the real installation, preserves profile
bytes, launches the same UI, and rejects tampered or incompatible inputs before
installation mutation. No exact public package, website deployment, or ARM64
runtime claim followed from the bounded source plumbing itself. Subsequent
explicit release authorization published non-latest `crostini-v0.1.0`,
deployed the pinned website bootstrap, independently verified both public
archives and the signed manifest, and passed the exact public install,
Launcher, connected React surface, and stop/relaunch path on the physical
x86_64 Chromebook. ARM64 retains native hosted build/archive evidence without
a physical runtime claim.

Tactical
[`178`](../tactical/178-crostini-storage-guidance.md) uses the exact Crostini
health identity as a presentation-only capability. Add and Downloads Settings
recommend Linux Downloads, explain that ChromeOS Files already exposes it,
and expand to the exact **Share with Linux** and native folder-picker steps
for users who prefer direct **My files** access despite the measured
performance penalty. The help does not require a keyboard shortcut or typed
Linux mount path. No portable application command, root policy, or other
platform presentation changes. A physical x86_64 Chromebook
Launcher run proves the collapsed/expanded Settings states, Add dialog, and
Files-app **Share with Linux** context action; its synthetic add was cancelled
with a zero-torrent queue and the original public install was restored.

Tactical
[`166`](../tactical/166-desktop-native-bootstrap-and-extension-scaffold.md)
implements only the bounded predecessor seam: a self-contained Manifest V3
JSTorrent Beta popup/service worker and the distinct
`com.jstorrent.rstorrent.native` compatibility/launch host. The host owns no
torrent, profile, listener, or application service. Desktop first launch
repairs exact per-user Chrome registration to a content-versioned stable host;
AppImage launch metadata points at the stable AppImage rather than its
temporary mount. Chrome Web Store item `gcgoepclopkgijmclmlheafaglmbjlcc` and
its public key are pinned, validation independently derives that identity, and
the host manifest allows only its exact beta origin beside the production
JSTorrent origin. The installed Chrome `hello`/launch smoke is complete:
Chrome 151 on an installed unsigned macOS arm64 app reports the exact beta ID,
completes native `hello` while the app is stopped, and cold-launches the
desktop product. This seam does not claim an extension control surface.

Android uses UniFFI-generated Kotlin records, enums, objects, and suspend
functions. A small Kotlin adapter exposes subscription handles as lifecycle-
aware `Flow`s and maps portable application values into presentation models.
Peer payload, piece payload, file payload, and hashing do not cross UniFFI.

Shared application semantics do not require identical presentation. Existing
cross-surface contracts remain valid where already implemented, but new
desktop inspection views do not imply Android UI work unless a later product
decision says otherwise.

## UI Reuse Direction

The existing JSTorrent Android application is the primary Compose product
reference. Reuse or adapt its screen composition, navigation, piece
visualization, notification and power-management behavior, SAF root-selection
experience, and platform lifecycle lessons.

Tactical `117` makes that reuse direction concrete: a single-stack Material 3
Library leads to one torrent detail route with Details, Status, Files,
Trackers, Peers, and Pieces tabs, while Speed, dual-family DHT, structured
Logs, and Settings remain global routes. Preserve JSTorrent's hierarchy,
interaction rhythm, and density with JSTorrent branding. Replace QuickJS-
specific health presentation with Rust-native application metrics, and never
enable a setting whose durable/effective behavior is absent.

Do not preserve its QuickJS controller, stringly typed subscription topics,
combined mutable `EngineState`, daemon topology, or view-model workarounds as
compatibility requirements. New Kotlin repositories consume typed RSTorrent
views and emit atomically reduced presentation state.

Any copied source must record its exact JSTorrent revision and MIT provenance,
retain required copyright and permission notice coverage, and be reduced to
the portion actually reused. Tactical `008` uses the sibling revision recorded
in `reference/pins.toml` and identifies every imported file in its execution
record.

## Shared Web Application

Web presentation code depends on a narrow generated client package, not on
Tauri globals or WebSocket APIs directly:

```text
shared components and reducers
             |
     ApplicationClient
       /           \
Tauri adapter     Remote adapter
```

Platform-specific capabilities such as folder selection, tray state, external
URL opening, or updater presentation use a separate platform-capability
adapter. They do not enter torrent commands or view patches.

The Tauri bootstrap now injects a separate desktop updater controller while
browser/demo/live-gateway entry points omit it. Only that capability adds
About & updates and the accessible availability notice; update state does not
enter the generated application contract or torrent presentation owner.

The shared presentation is a strict-TypeScript React application using
component-scoped CSS Modules and a permanent named-demo adapter.
It preserves JSTorrent's information hierarchy without inheriting its source
architecture and adapts one library/list/detail model from wide desktop to
phone-sized browser layouts. Stable Rust torrent and peer views are now mapped
through the live application adapter. Tactical `060` deleted the older
direct-DOM gateway surface, made the named demo the no-mode root, and moved
ordinary live-browser calls and view sets onto one multiplexed
WebSocket. HTTP remains available only as an explicit loopback diagnostic
query, while Tauri stays in process. The detailed direction and open choices
live in
[`web-ui-design.md`](web-ui-design.md).

The ordinary browser surface proves its network transport on loopback with
explicit test credentials. Tactical `076` separately permits one
maintainer-operated private host behind TLS and Basic authentication, with the
gateway enforcing the same credential and exact HTTPS Origin. That bounded
deployment is not a claim of safe general Internet exposure. Pairing,
accounts, relay operation, wake-up delivery, stable compatibility, and product
remote-access policy require later threat models and tacticals. Ready Tactical
`192` now owns the first bounded exception: one named authorized-browser
registry, automatic challenge-bound resume and an owner-visible security
surface above the existing application client, exercised only against distinct
local HTTPS/WSS origins and a loopback-only relay service.

Completed Tactical
[`170`](../tactical/170-configured-linux-headless-service.md) turns that shared
browser surface into a first-party ordinary-user Linux service package. Its
local-session and private-host Basic modes retain same-origin HTTP/WebSocket
semantics, while the service owns the application/profile independently from
every attached tab. It adds no extension transport or owner E2E remote claim.

Completed Tactical
[`174`](../tactical/174-exact-tailnet-headless-access.md) permits the same
installed service to expose multiple explicit endpoint adapters around that
one application owner. The current machine retains its exact LAN HTTP/WS
authority and adds one exact loopback backend behind a tailnet-only Tailscale
Serve HTTPS/WSS authority. Each gateway enforces its own exact Host and
Origin, and media capability URLs use the origin through which they were
created. The shared React client reports the credential-free network posture,
shows its full-owner explanation once per browser origin, and retains
`No auth` after dismissal. Tailnet ACL admission remains an operator boundary,
not RSTorrent owner E2E authentication.

Tactical `035` also adds an explicit unauthenticated development mode for
local UI bring-up and headless evidence. It binds only loopback, requires one
exact configured loopback Origin, retains resource checks, and isolates opaque
view-set owners. Harnesses may use an OS-assigned port; Tactical `109` permits
the local hosted launcher to use its explicit stable loopback port. It is a
development convenience, not a production browser-control posture; the
authenticated mode remains.

The manual launcher uses one fixed-origin gateway to serve the production
bundle and the application API, rather than running a Vite preview beside an
ephemeral gateway. The browser derives application authority only from its
page origin, so the visible root URL survives launcher restarts. The launcher
stores its profile beneath ignored `.local/webui` by default. It is a
maintainer-facing local bridge, not a change to the accepted in-process Tauri
product architecture. Tactical `048` makes that same React
application the Tauri product entry through an in-process adapter. The React
application currently supports inspection, magnet and local `.torrent` add,
pause/resume, force recheck, archive/restore, removal, and Normal/Skip file
selection, but not the full application command set. Its HTTP, WebSocket, and
Tauri clients implement the generated transport-neutral byte-intake operation.
Completed Tactical
[`203`](../tactical/203-jstorrent-shaped-add-time-file-selection.md) makes that
intake a shared staged flow when the default-on product preference is enabled.
React emits transport-neutral magnet or byte intent; only the live adapter
constructs the generated application request and chooses the active transport.
The application owns pending FIFO, metadata wait, exact totals, and atomic
confirm/cancel; React owns only the bounded checkbox draft. Disabling the
preference retains the established immediate all-file behavior.
Typed and curated magnet intake share that path. A deterministic catalog test
keeps the UI shortcuts identical to `tests/live/torrents.json`; public swarm
availability remains variable evidence rather than a UI guarantee.
Torrent More and context menus copy one v1 magnet per selected torrent and
join them with newlines in stable application order. The application returns
a verified retained magnet verbatim when available; `.torrent`, missing, or
integrity-failed sources synthesize `xt`, verified `dn`, and the normalized
tracker catalog within current magnet bounds. The UI performs one clipboard
write only after every export succeeds and reports bounded tracker omissions.
Routine torrent rows and views still contain no source URI or tracker secrets.

## Reactive Views

Presentation consumes named, versioned application views rather than arbitrary
field queries or engine structs. The accepted successor contract in
[`application-view-api.md`](application-view-api.md) groups one client's
currently relevant projections into a leased view set with one epoch, cursor,
and bounded update accumulator. Each named view selects:

- an application object or collection;
- a named projection such as summary or piece activity; and
- a bounded delivery policy.

Every view begins with a coherent snapshot. Typed update batches carry a
view-set epoch, base cursor, resulting cursor, durable revision, and per-view
snapshot, patch, or reset values. Cursor gaps, incompatible epochs, invalid
patches, expiry, or bounded-queue overflow require resynchronization from a
snapshot; events are never the only recovery authority.

Engine edges feed independent per-view accumulators within each view set.
Delivery may coalesce without losing the final state:

- torrent summaries use keyed latest-value upserts and explicit removal;
- verified piece changes union ranges while recheck can explicitly clear
  ranges;
- active block state uses the latest bounded mask for each active piece;
- counters and rates sample or conflate instead of enqueueing every byte; and
- a slow subscriber cannot consume, clear, or delay another subscriber's
  updates.

Durable application revision and volatile view-set cursor are separate.
High-frequency block activity neither writes SQLite nor advances the durable
command revision.

## Portable Contract Types

Rust application-contract records and enums are the canonical semantic source.
The contract uses a deliberately portable subset with explicit representations
for identifiers, byte strings, large counters, optional values, and tagged
variants.

- serde defines the diagnostic and initial network representation;
- generated TypeScript exposes discriminated unions and client inputs;
- generated JSON Schema validates the structural network representation while
  handwritten checks retain semantic and resource bounds;
- UniFFI generates Kotlin values for the in-process Android boundary; and
- handwritten semantic validators reject invalid bounds and cross-field
  relationships at runtime.

JavaScript cannot represent every Rust `u64` exactly. Portable revisions,
sequences, and unbounded counters use an explicit decimal representation or a
proved safe bound rather than silently rounding JSON numbers.

Generated artifacts are deterministic and checked for drift. Rust, TypeScript,
and Kotlin reducer fixtures must converge on the same state.

The web application materializes validated view batches through a pure reducer
into one per-application Zustand vanilla store. A separate `ViewController`
owns the view-set identifier, cursor, polling or streaming task, retries,
cancellation, and connection status. React components use narrow selectors;
transport tasks and handles do not live in the store.

## Lifecycle

View clients are detachable. Closing a browser tab, Tauri window, or Android
activity closes its view set or subscriptions without stopping the application
service or active download.

A browser tab may be suspended without running close handlers or polling
timers. The application-owned five-minute lease therefore destroys a silent
view set independently from later client traffic. On resume, the web
controller marks retained values stale, opens one replacement set from its
latest desired views, and atomically installs fresh snapshots before applying
new patches. Visibility and online events may accelerate this path but do not
own correctness.

- Tauri owns the application service independently of its webview window and
  may remain alive in the tray. Completed Tactical `162` registers the
  single-instance owner before service startup, defaults close to hidden
  background operation, persists that shell policy independently from the
  profile, restores the existing window from the tray or a second launch, and
  joins service/media shutdown before close, tray Quit, or updater restart can
  terminate the process. Tactical
  [`179`](../tactical/179-disposable-incubation-state-epoch.md) retains only
  the current version-3 shell settings reader; version 1, version 2, malformed,
  oversized, and unknown records atomically repair to current defaults.
- Completed Tactical
  [`164`](../tactical/164-desktop-completion-and-attention-notifications.md)
  adds a Tauri-only native Rust owner for edge-triggered completion and
  fatal/repair notifications. It consumes the existing authoritative
  in-process torrent-list view independently from React, does not replay
  initial/reset terminal state, and exposes only typed shell preferences to a
  capability-gated desktop Settings category. The standard Tauri Rust backend
  owns macOS/Windows; Linux retains the underlying native handle directly for
  GNOME display and bounded click activation. Android and iOS keep their own
  platform notification owners.
- Completed Tactical
  [`165`](../tactical/165-cross-platform-active-download-sleep-inhibition.md)
  adds a separate Tauri-only default-on Power preference and a native Rust
  level owner over authoritative torrent-list state. macOS/Windows use exact
  `keepawake` 0.6.1, GNOME uses its suspend inhibitor, and other Linux sessions
  use a bounded XDG portal fallback. `Starting`, `Downloading`, and `Checking`
  hold one system-idle/suspend request; pause, queue, completion, seeding,
  failure, disablement, and joined shutdown release it without suppressing
  display blanking.
- Android's foreground service owns the application service independently of
  activities. Tactical `165` also gives that service one default-on native
  preference and exactly one partial CPU wake lock for the same active state
  set while removing its Wi-Fi lock. iOS retains finite background work and
  exposes no misleading general keep-awake control.
- Tactical
  [`200`](../tactical/200-android-product-background-lifecycle.md) replaces
  Android's always-sticky lifetime with one activity-aware owner. Visible
  Compose retains interactive use; background download continuation is
  default-off and notification-gated; completion stops unattended work by
  default; continued seeding is separately opt-in; and every policy stop joins
  the generation without rewriting durable torrent intent. Authenticated
  ChromeOS companion work receives a fixed reconnect grace through a count-
  only subscription. Android-15 timeout persists an exhausted edge and blocks
  invisible recreation until a visible launch. Connected API 28/35 and owned-
  AVD transfer/recovery/seeding/task-removal/timeout evidence passes. The gate
  initially closed by maintainer-approved composition with deterministic
  companion lifetime coverage and Tactical `194`'s physical ChromeOS
  transport/security evidence. A later physical ChromeOS 150/API-33 run now
  adds direct Home/reopen, sticky recovery, completion, controlled background
  upload, seeding disable, authenticated companion retain/grace/reconnect/
  expiry, notification denial/grant and Stop, relaunch, listener refusal, and
  exact cleanup evidence. It adds no indefinite or OEM-wide duration claim.
  No reboot launch, second daemon, indefinite `dataSync` claim, or low-battery
  policy is added.
- The Linux headless process owns one application service, profile, one or
  more explicitly configured gateways, and engine independently from browser
  connections. Its systemd user unit forwards stop to the adapter, whose
  cancellation path joins every gateway and the application owner before
  exiting; no synthetic view is retained while idle. Tactical
  [`171`](../tactical/171-signed-headless-release-and-lan-service.md) adds one
  serialized host-side signed-release checker. Browser startup/daily checks are
  quiet on current or network failure, manual results are visible, and apply
  remains an explicit installed shell command; the browser never owns package
  replacement or service restart.
- A remote WebSocket connection owns only its authenticated commands and
  subscriptions.

The same detachment rule applies when the application service was explicitly
opened with ephemeral state. The service retains its private session and
speed-history databases until its application owner performs joined shutdown;
closing the last tab, window, activity, connection, subscription, or view set
does not clear them. No visible client mode selector is implemented by
Tactical `075`.

Every subscription and adapter task has explicit close, cancellation,
termination observation, and bounded queued state.

## Headless Presentation Validation

The authenticated loopback browser gateway is the preferred automated seam
for shared web presentation. Repository harnesses run the real application
service and shared browser UI with temporary profile, storage, and browser
directories, then drive a headless Chrome process. This proves the same web
components embedded by Tauri without launching or focusing a desktop window.
Tauri compiles without launching a window and its pull/stream transport
adapters are directly tested; the gateway does not become the local desktop
product transport.

Tactical `034` adds a still smaller deterministic seam: named demo scenarios
implement the same frontend application port without starting Rust, a gateway,
or torrent networking. Headless Chrome now retains wide, compact, phone,
accessibility, keyboard, command, and large-collection evidence against that
adapter. Real adapter tests remain necessary when Rust projections connect;
demo evidence does not claim engine behavior.

Tactical `170` adds installed-service evidence beyond the temporary browser
harness. On x86_64 Ubuntu, every client detached during an 8-MiB
controlled transfer, a fresh client recovered complete durable state,
RSTorrent then seeded the exact payload back to pinned libtorrent, and the
service remained healthy while idle with zero gateway sessions. Joined
restart, rollback-safe repair, preservation-safe uninstall, and exact cleanup
also pass through the same production React/WebSocket surface.

Tactical `174` adds an installed multi-endpoint presentation proof. One
systemd user PID owns the exact LAN and loopback-proxy sockets around one
application/media owner. Both the LAN HTTP/WS authority and the Tailscale
Serve HTTPS/WSS authority pass health, API, application WebSocket, and real
media-capability creation; the returned capability uses the serving
authority's exact origin. A 456-by-1024 tailnet browser run loads without page
errors, opens WSS, dismisses the network notice, and retains dismissal after
reload. Wrong Host and cross-origin requests return `403`. A physical off-LAN
phone retry is not yet claimed.

Tactical `035` supplies that real-adapter evidence. The production-built web
surface connects to a temporary loopback application and controlled
libtorrent seed, observes active requests through verified completion, and
removes the peer row after cleanup. A deliberately silent browser client
outlives a shortened test lease, displays retained state as stale, then opens
a distinct view set and installs a fresh coherent snapshot. Wide, compact,
phone, accessibility, payload-hash, process-join, and temporary-cleanup checks
run without a visible browser or Tauri window.

Tactical `072` extends that same production-built browser seam with a delayed
metadata, eight-file controlled torrent and pinned libtorrent `2.0.13` peer.
The headless run observes a truthful metadata-pending detail, six recognized
videos in numeric episode order, all eight literal files including two
sidecars, exact progress/completion, Media/Files lease replacement and
eviction, one application upgrade, zero semantic HTTP requests, empty serious/
critical Axe findings, joined shutdown, and exact cleanup in 33.570 seconds.
Tauri reuses the same React/store/view contract without opening a loopback
server or launching a visible window.

Tactical `083` adds a focused production-build browser proof without a
visible window. Headless Chrome receives a real `filechooser` event from empty
Add, selects an independently generated 157-byte v1 source, confirms
metadata-only intake, and observes one application WebSocket, one binary
attachment, zero semantic HTTP requests, the exact visible torrent row, and
zero serious/critical axe findings. Gateway metrics record one upload
declaration/admission and zero retained connections after joined shutdown;
the metadata-only run creates no payload artifacts. Tauri reuses these React
components and its tested raw-IPC adapter rather than gaining a path or native
source-file owner.

Tactical `151` extends that authenticated production-browser seam from paused
intake through an exact pure-v2 lifecycle. One v1 control remains paused while
the v2 row selects a skipped file, completes wanted bytes over uTP, exposes
verified file behavior, force-rechecks, restarts without another source
upload, and retains selection and exact output. The generations observe one
binary source attachment where expected, no semantic HTTP control calls, no
serious/critical accessibility findings, no part artifact, and joined gateway
cleanup. Tauri's direct adapters pass without a visible launch. The Android
Compose application independently passes complete and selective pure-v2 SAF
profiles on an owned API 34 no-window AVD, including restart/recheck,
publication, exact upload, bounded handles, and cleanup.

Tactical `155` adds the production magnet lifecycle to that seam. The browser
uses exact `btmh`, one peer hint, and select-only intent; it completes wanted
files, leaves the skipped file absent, exports the canonical magnet, restarts
without peer traffic, and removes exact managed data with no semantic HTTP
control or accessibility regression. The Android AVD independently interrupts
an incomplete verified candidate, refetches hashes after restart, completes
and promotes selection, serves a magnet-only libtorrent leecher, and cleans
SAF state within the existing 40-handle and 16-request bounds. Tauri and iOS
require no new presentation contract; their adapter/build gates pass.

Tactical `156` adds the hybrid lifecycle to the same production seams. The
browser reconciles separate exact `btih` and `btmh` additions into one row,
retains both identities, applies exact selection, restarts complete, serves
hash and payload requests, and removes exact managed state with bounded
gateway ownership and zero Axe violations. The Android AVD runs a six-file
SAF hybrid, promotes selection, serves both direct-v2 and upgraded routes,
synthesizes padding, restarts/rechecks without peer payload, and cleans within
the existing handle/request bounds. Desktop and iOS require no new contract.

Android presentation requires separate evidence because it is implemented in
Compose. Routine automation targets an explicitly owned no-window AVD and
uses generated-contract, reducer, Compose, and UIAutomator checks. Physical
devices, visible emulators, and host GUI automation require explicit user
authorization.

The browser gateway's listener policy and the application service's torrent
egress policy are independent. Routine browser evidence binds the gateway and
limits engine egress to loopback. Product desktop control remains in-process
even though its engine permits routed peers and trackers. Android likewise
runs the online engine inside its foreground service rather than through a
socket proxy.

Tactical `098` packages the Cargo-version-matched platform-verifier AAR and
adds one application bootstrap before either Android service can construct a
native network owner. JVM ordering tests, both established ABI builds, APK
inspection, and an API 34 arm64 no-window AVD pass. The AVD rejected a
controlled invalid certificate before HTTP, accepted a public trusted origin
through HTTP, and completed the explicit disabled-policy SAF transfer against
pinned libtorrent. No Compose setting or visible product launch was added.

## Diagnostics Surfaces

Tactical `012` gave the original shared web/Tauri surface and Android Compose
the same semantic progress dispositions, reason codes, diagnostic categories,
severity filters, default profiles, dropped-event indication, and bounded copy
behavior. Tactical `049` now gives desktop/web a richer global ordered console
with structured expansion, producer capture controls, and explicit source,
delivery, and local loss. Android retains its smaller product-appropriate
summary and shares compatible generated record types; detailed presentation
parity is deliberately not required.

Progress assessment remains a deliberate product view. Diagnostic records are
a separate bounded timeline and are never scraped to decide torrent state or
actions.

## HTTP Playback Data Plane

Desktop/browser and Android hosting now expose bounded ephemeral capability
URLs for published and eligible active torrent files. That server is a content
data plane, not the command and reactive-view transport. Android starts its
exact-loopback listener only on the first native Play request.

Tacticals `138` and `139` implement exact interface binding, capabilities,
expiry/revocation, `HEAD` and single-range behavior, verified-only active
reads, bounded incomplete-file scheduling, body/backpressure limits, and
joined lifecycle ownership. File bytes flow between Rust storage and HTTP
clients without crossing the UI contract. Embedded desktop playback, stable
sharing, and remote exposure remain independent product decisions.
Completed Tactical `189` exposes that existing data plane as Library Media
Play: a direct browser activation reserves an isolated tab before requesting
the exact file capability, then browser-native media handling consumes the
URL. This adds presentation only; capability eligibility, byte service,
streaming demand, expiry, and revocation remain unchanged.
Completed Tactical `202` adds the corresponding Android-native presentation:
Compose **Play** launches one private Media3 activity for typed available or
streamable video, while completed **Open** remains. The activity owns audio
focus, transport controls, picture-in-picture, error presentation, and one
existing playback interaction lease; Rust retains all HTTP, verification,
demand, handoff, SAF, capability, and listener ownership.
Completed Tactical `203` similarly composes one native add-time selection
dialog with the shared application owner. Compose pages the authoritative file
catalog, retains only compact Normal/Skip draft intent, survives Activity and
process replacement, and never turns Back or dismissal into Download All.
Installed API-35 and physical ChromeOS API-33 partial-selection campaigns pass
with exact SAF cleanup.

## Current Gaps

- Completed Tactical
  [`204`](../tactical/204-cross-product-localization-foundation.md) gives
  shared React/Tauri, Android, and iOS complete checked English catalogs,
  system locale negotiation, locale-aware formatting, strict
  provenance/placeholder checks, and LTR/RTL pseudo evidence. The remaining
  localization gap is promotion of the independently reviewed German preview
  to a production language cohort; no non-English production locale is currently advertised.

- The React Library now has a rebuildable media-first torrent detail, but its
  top level remains torrent-backed. Library-wide item aggregation, durable
  media identity/organization, thumbnails or provider artwork, watched state,
  and embedded desktop playback remain separate product capabilities.
  The browser-hosted UI plays completed MP4/M4V/MKV in an in-page dialog
  (Tactical 362) and keeps the new-tab handoff for other files, and Android
  has native progressive playback from the Files surface. iOS has no
  corresponding progressive derived-media presentation.

- The loopback WebSocket gateway and configured private-host Basic service are
  not a production owner-remote-access design. Tacticals `190` and `192`
  establish the account-free passphrase/host-pin protocol plus a durable
  product owner, resumable named-browser registry, exact revocation and full
  authorization/circuit audit. Desktop composition and explicit headless
  opt-in now select a fixed WebPKI product relay, and the website build owns an
  atomic `/remote/` React/Wasm artifact. The relay/client origins are active as
  an unadvertised canary, and source-built Chromium plus Playwright
  Firefox/WebKit pass the production origins. The signed-package and external
  browser/ISP matrix, rollback/renewal soak, wake-up path and public wire
  compatibility promise remain absent, so owner remote access is still an
  implemented but unsupported capability.
- The configured Linux headless surface now also supports exact RFC 1918
  `lan-none`, with a one-time per-origin notice that authentication is absent
  and every LAN client has full owner control. Dismissal survives reload while
  a compact `No auth` header status remains. Exact Host/Origin checks and a
  physical Android phone load pass on the installed current-host service, but
  this is neither encrypted nor authenticated remote access. Strict
  two-architecture signed release, bootstrap, and explicit check/apply source
  machinery exists; no public `headless-v*` candidate or stable manifest has
  been promoted, and native Raspberry Pi service/update evidence remains
  absent.
- The same service also supports one exact loopback endpoint behind an exact
  Tailscale Serve HTTPS authority. This keeps the application off wildcard and
  Tailscale interface binds, but it remains credential-free inside the
  admitted tailnet policy: every reachable identity is an owner. It is not a
  passphrase/device/relay remote-access claim, and physical off-LAN phone plus
  native Raspberry Pi evidence remain absent.
- The Tauri shell has basic macOS close-and-reopen behavior, provisional icon
  assets, ordinary local bundle configuration, implemented updater UI/
  lifecycle behavior, and hosted signed package evidence across macOS arm64/
  x86_64, Windows x86_64, and Linux arm64/x86_64. Public `desktop-v0.1.0` and
  `desktop-v0.1.1`, one installed macOS arm64 launch/updater-init smoke, and an
  exact macOS arm64 and Linux arm64 replacement/relaunch campaigns with
  updater-ID continuity pass. Windows x86_64 replacement/relaunch passes under
  an automatic-loopback profile, but fresh-default local-network listener
  selection prevents startup in those public builds. Completed Tacticals `160`
  and `161` repair that startup path and add the parented native picker on
  `main`; an unsigned installed Windows campaign passes fresh-profile cancel,
  selection, default persistence, unavailable-root repair, and controlled
  process restart. The next signed update, installed Linux x86_64 picker/update
  evidence, and Windows firewall-consent characterization remain open;
  installed Intel macOS testing is deliberately omitted. Completed Tactical
  `162` adds the selected production tray policy, one desktop instance,
  default-on persisted background operation, visible tray update checking,
  joined shutdown/restart, native Linux arm64 packaging, and installed Windows
  x86_64/Linux arm64 lifecycle/icon evidence. Completed Tactical
  [`163`](../tactical/163-desktop-external-torrent-intake.md) adds bounded
  installed `magnet:` and local `.torrent` association/handoff through that
  same owner and the existing Add flow. Deterministic Rust/React and package
  gates pass, as do installed Linux arm64, Windows x86_64-application, and
  macOS arm64 cold/visible/hidden/cancel/failure/duplicate/Quit campaigns. The
  Windows package was a real x86_64 PE exercised under Windows 11 arm64 x64
  emulation. The macOS campaign preserved JSTorrent's inherited default while
  targeting the registered incubation bundle through LaunchServices. The exact
  hosted eight-job run also passes. Completed Tactical `164` closes the
  bounded native desktop-notification gap with deterministic/package gates and
  installed macOS arm64, Windows x86_64, and Linux arm64 evidence. Completed
  Tactical `165` closes active-work sleep inhibition with installed macOS
  arm64, Windows arm64, Linux arm64, native Windows x86_64, physical Android
  API 37, and physical iOS evidence through guest/device-native
  machine-control routes. The native x86_64 repeat used the exact unsigned
  package from all-green workflow run `32884674167`; package trust and the
  integrated signed update remain with Tactical `158`. Broader cross-platform
  window/platform-capability evidence remains open. The release gates live in
  [`beta-release-readiness.md`](beta-release-readiness.md).
- The maintained Android product module now lives at `clients/android`; the
  unreleased `org.rstorrent.bootstrap` identity and retained diagnostic service
  remain explicit release-cleanup decisions rather than evidence that the
  Compose client is still an experiment.
- Android now has a packaged extension client over the one
  `ProductEngineService` application owner, with exact ARC host permission,
  explicit pairing, extension-triggered SAF picker, and retained multi-root
  registry. Physical Compose/React convergence and detached transfer pass.
  Completed Tactical `194` replaces the former wildcard listener with ARC's
  fixed guest address: the exact ChromeOS extension connects while the
  Chromebook Wi-Fi address and spoofed same-LAN requests refuse. Production
  extension rollout and Android replacement readiness remain separate in
  [`android-jstorrent-replacement.md`](android-jstorrent-replacement.md).
- Android durable SAF session storage is physically proven across two retained
  roots. The Compose product presents root setup, current/default selection,
  health, repair, bounded removal, High/Normal/Skip file priority, `Download
  now`, and completed-file open. Physical evidence preserves old-torrent root
  binding through current-root change, grant loss/repair, update, and restart.
  Relocation and cloud/removable-media policy remain product gaps.
- The Android Compose product now presents authoritative multi-torrent queue
  and concurrent-admission state plus live Peers, Files, Trackers, Pieces,
  Disk, Swarm, Logs, Speed, and dual-family DHT projections. Search/plugins,
  VPN/proxy policy, and tracker mutation remain explicitly unavailable rather
  than discarded or simulated. Completed Tactical `202` adds native
  progressive video playback without adding a second engine, scheduler,
  storage reader, or HTTP implementation. Completed Tactical
  [`197`](../tactical/197-android-external-torrent-intake.md) adds bounded
  external `magnet:` and cross-package `content://` `.torrent` activation to
  the one `singleTop` activity and service-owned application flow. Generic
  Compose confirmation retains root/start choice, while hostile providers,
  temporary grants, cancellation, timeout, duplicates, resource bounds, and
  exact cleanup pass on API 34 without changing the generated contract. Manual
  session and torrent peer-transfer limits are implemented. Completed
  Tactical `175` carries
  exact retained Swarm payload download/upload totals through the generated
  UniFFI/Kotlin record and dual-ABI build. Compose currently presents only the
  Swarm catalog summary, not peer rows, so it does not fabricate a parallel
  row presentation for those fields. Tactical `186` makes Speed compose an
  independent tiny current-rate subscription with graph history selected only
  on that route; inactive routes receive neither hidden graph history nor
  unrelated detail projections. iOS still has no Speed presentation or
  interest, although its maintained reducer accepts both independent contract
  shapes exactly.
- Completed Tactical `187` adds one selected `torrent_preparation` contract.
  The shared React General view requests it only while visible and presents a
  bounded BEP 9 Canvas plus a separate coarse v2/hybrid hash-preparation card.
  Android and iOS explicitly reduce the generated optional record so their
  boundaries remain exhaustive, but add no Compose or SwiftUI presentation;
  native presentation remains a separate product decision.
- Diagnostics currently cover application lifecycle, discovery exhaustion,
  network restriction, tracker policy rejection, metadata, storage, piece,
  integrity, and terminal MSE handshake edges, including role, captured policy,
  exact negotiated method or typed failure, fallback use, byte accounting, and
  exponentiation count. Deeper tracker-attempt, scheduler, and performance
  instrumentation remains to be added as those runtime owners grow.
- Android now exposes the default-off **Unmetered networks only** cost policy.
  Tactical
  [`199`](../tactical/199-android-live-unmetered-network-enforcement.md) adds
  ordered default-network observation, fail-closed startup and live engine
  permission, joined BitTorrent network convergence, intent-preserving
  automatic recovery, and truthful React, Compose, companion, DHT, and
  foreground-notification state. Deterministic and installed API 28/35 AVD
  evidence passes; the supported-phone gate still awaits explicit physical-
  handoff authorization. VPN-grade leak prevention still requires Android
  network binding and race analysis; proxy remains separate.
- Tactical [311](../tactical/311-android-notification-settings-consolidation.md)
  consolidates Android Notifications into one permission/app/channel status row
  opening Android system controls: Enable without permission, Manage otherwise.
  System controls remain reachable after permission denial; completion and
  attention preferences remain independent. The duplicate Open row is removed.
  Debug build, 123 JVM cases, lint, catalog checks and two focused navigation
  cases on each owned API 28/35 AVD pass.
- Android's one service-native notification owner now reports generic
  foreground state and derives bounded completion plus fatal/storage-repair
  edges from the authoritative torrent-list stream. Default-on app preferences
  remain independent from low/default/high system channels; exact taps route
  to torrent detail or Storage, and initial/reset/restart/recheck state does not
  replay. Denied or blocked notification visibility permits visible Compose
  work but joins the service and companion after the last interaction lease;
  target-35 `dataSync` timeout uses the same joined non-sticky stop. Tactical
  [`198`](../tactical/198-android-completion-and-attention-notifications.md)
  is complete with passing deterministic, dual-ABI, API 34/35 connected and
  genuine transfer/repair evidence. Its physical ChromeOS 150/API-33 evidence
  proves exact completion-to-torrent and attention-to-Storage taps,
  notification removal, zero restart/recheck replay, malformed-path
  restoration, denied-visible-only behavior, permission grant, companion
  disconnect/reconnect, ongoing-notification Stop, and cleanup. Tactical
  [`200`](../tactical/200-android-product-background-lifecycle.md) implements
  the granted-background activity/active-work/completion/seeding/task-removal
  contract and accepts Android 15+ `dataSync` operation as finite. Its
  connected API 28/35 and owned-AVD campaigns pass. Its completed evidence now
  includes the later physical ChromeOS 150/API-33 lifecycle, companion,
  notification-Stop, relaunch, listener-refusal, and cleanup strengthening in
  addition to the original compositional close. VPN policy remains separate
  from Tactical `194`'s connection transport.
- Tactical [319](../tactical/319-android-ongoing-notification-rates.md) shows
  session payload download and upload rates in the ongoing notification while
  downloading or seeding in the background, and in ready states while either
  rate is nonzero. One state collector owns the notification content,
  including data-reset progress; status changes post at once and rate-only
  changes at most every two seconds.
- Android now has Compose connection/seeding settings for backed peer, upload-
  slot, active-download, listener, port-mapping, IPv6, and encryption values,
  including configured/effective/application truth, plus backed session and
  per-torrent upload/download limits. The default-off metered-network cost
  policy is implemented by Tactical `199` and AVD-qualified, with only its
  authorized physical-phone gate open. Background lifetime is implemented and
  qualified by completed Tactical `200` through its accepted AVD and
  deterministic evidence, prior Tactical `194` security proof, and later
  physical ChromeOS 150/API-33 lifecycle strengthening.
  Completed Tactical
  [`201`](../tactical/201-durable-seeding-goals-and-seed-admission.md) adds the
  exact pinned libtorrent global active-seed and ratio/time priority settings
  plus truthful active/queued/goal status to React and Compose. Wide and phone
  browser gates and an installed API-35 Compose profile prove the backed
  values, Unlimited, exact `1 active / 2 queued` truth, and priority-not-stop
  copy. VPN, proxy, and low-battery remain separate product/engine slices.
  Completed Tactical
  [`205`](../tactical/205-durable-dht-and-pex-controls.md) also exposes backed
  default-on DHT and PEX switches here. Both apply live through the common
  engine owners, report application state, and cannot weaken private-torrent
  discovery exclusion.
  Completed Tactical
  [`206`](../tactical/206-android-jstorrent-feedback-handoff.md) adds one
  Android-only Advanced Settings action that opens the existing JSTorrent
  feedback page in the external browser with its exact four environment
  fields. Exact URL/failure tests, a focused API-35 Compose/platform run, and
  a physical ChromeOS page/form/GitHub/return check pass. It adds no Rust/
  application contract, report backend, diagnostic export, durable state, or
  client-owned browser surface.
  Implementation-complete Tactical
  [`207`](../tactical/207-android-safe-reset-and-clear-data.md) enables the two
  Advanced Settings actions and three exact outcomes: atomic configured-
  default engine-settings reset, joined profile clear while preserving every
  registered payload, and joined profile clear with unchecked-by-default
  metainfo-exact payload deletion. Its service-owned count-only progress,
  bounded failure, Retry, and separately confirmed keep-remaining recovery
  survive navigation and activity recreation. Compose plus API 28/35 reset,
  keep-clear, and persisted-phase recovery evidence passes. An owned API 35
  two-root profile also passes Keep, re-add/recheck, exact DeleteData,
  sentinel preservation, bounded descriptors, and recovery from a genuine
  mid-delete process death. Physical ChromeOS qualification remains active.
  Implementation-complete Tactical
  [`208`](../tactical/208-installation-metrics-and-feedback-parity.md) widens
  support presentation across shared React and Compose with a localized first-
  use disclosure, durable preference, identifier/counter reset, exact field
  preview, privacy link, and confirmation. The MV3 extension separately owns
  its strict local record and bounded uninstall-survey URL. Richer query
  fields remain fail-closed until the corrected hosted source is deployed and
  publicly verified, so Tactical `206`'s four Android environment fields and
  the separately disclosed updater ID after acknowledgement (or its valid
  adopted legacy exception) remain the only enabled stable-context behavior.
- Tracker HTTPS authentication is intentionally absent from ordinary React
  and Compose settings. The advanced typed `disabled` override exists for
  compatibility/debug use and remains visibly unauthenticated in tracker
  rows; custom roots, pins, and certificate-management UI are absent.
- No embedded desktop playback UI, stable media sharing, or remote media
  listener exists. Android's media-only HTTP listener is exact loopback,
  starts lazily, and remains private to one application generation.
- The maintained RSTorrent iOS product now supports the bounded scope recorded
  by completed Tacticals `147`--`149`, `152`, and `154`: qualified selected
  folders,
  exact-target single- and multifile storage, publication, restart/Force
  recheck, truthful Complete/Published progress, completed-file handoff, direct
  Apple Quick Look/video playback after completion, the adapted first-party
  JSTorrent presentation, cold/warm intake, finite
  lifecycle and force-close recovery, and local archive creation. Search,
  cloud/provider roots, migration, indefinite background work, embedded or
  progressive playback, and public distribution remain absent.

Tacticals `008` and `009` record the implemented contract, exact controlled
evidence, and bounded deferrals. Tactical `012` records the completed
cross-surface observability slice motivated by the first public-magnet desktop
run. Tactical `013` records explicit product and harness network selection.
Tacticals `033` through `035` record the leased view-set boundary, responsive
demo surface, and first live peer projection plus recovery evidence.
Completed Tactical `117` records the Android product-presentation closure.
Production-shaped local remote authorization is implemented by Tactical
`192`, including private-browser automatic resume plus the local/remote security
surface for authorization inspection and revocation. The public client/relay
are active as an unadvertised canary, while support remains with the active
deployment tactical; dynamic Android network controls and broader desktop
lifecycle work remain later capability boundaries.
Completed Tactical `194` owns the bounded same-device ChromeOS Android
extension transport and retained-root SAF workflow. Its exact ARC-address bind,
ChromeOS extension connection, and same-LAN refusal are physically proven. Its
completion must not be described as full JSTorrent Android feature parity.
Signed
distribution, updating, CI, product identity, and beta MVP triage are tracked
in [`beta-release-readiness.md`](beta-release-readiness.md).

Tactical [`211`](../tactical/211-presubmit-signal-and-build-measurements.md)
separates companion-extension packaging and release-tool checks from the shared
web job so a packaging rejection cannot suppress contract/type/unit/E2E signal.
Its companion validator admits reviewed FormatJS diagnostic links using exact
host matching; the manifest permissions and exact ARC-only CSP are unchanged.

Finish-line 259's physical picker harness now confirms the observed owned-folder
breadcrumb after an entry tap. A refused/ineffective folder tap cannot authorize
acceptance of the Downloads parent. Fourteen focused harness safety cases pass;
physical retry remains in progress. No product SAF or lifecycle policy changes.
