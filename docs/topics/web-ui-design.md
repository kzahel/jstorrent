# Web UI Design

Tactical [357](../tactical/357-rich-share-links.md) turns the General link
icon into a **Share** panel (link, Copy, Share… where `navigator.share`
exists, QR code, Include my address). Files gains **Share file(s)**, menu
share copies ask once about including your address, and Settings →
Connection & seeding → Sharing changes that choice. A size known only from
the link reads "(from the link)" in General and "(link)" in the list. QR
colors use `--qr-dark`/`--qr-light`, dark on white in both themes.

Tactical [353](../tactical/353-host-product-in-hello.md) shows what the host
reports in its hello on About, so remote access and Crostini show the
host's version, build, target, profile and **Library folder**. The client
reads the hello again after each reconnect, so a host that restarted on a
new version is shown correctly without a page reload. The desktop
`getIdentifier()` lookup is gone; the hello carries the identifier.

Tactical [352](../tactical/352-render-first-web-startup.md) renders the real
shell before the engine connects, in the browser and in Tauri.
`LiveApplication.connect()` starts in `connecting` and attaches in the
background (transport, hello, view set), retrying as `reconnecting` behind
the existing overlay; commands wait for the attach. Until the first library
view, Torrents, Transfers and Library show placeholder rows or cards at the
real geometry, sidebar and table counts stay hidden, and connection and
download-folder settings are not editable. Before the bundle, the page is
only the stored theme's background; the branded card is kept for failures.
Transports, the generated validators, demo, Settings and the session panels
load off the shell's critical path, and startup phases are `performance`
marks reported as `startup_ms` in support diagnostics. The remote entry
still attaches before rendering because its gate returns to sign-in on a
failed first attach.

Tactical [351](../tactical/351-narrow-web-lists-and-flat-chrome.md) moves
Library and Torrents into the sidebar (the drawer at narrow widths, which
also lists the session views), gives narrow details an app bar with a back
arrow, Pause or Start and a ⋮ menu, and renders tables as stacked list items
at 760 px and below through per-column `listRole`s in `VirtualTable`. On
desktop only the header and sidebar stay tinted, and each table's count and
Columns join the bar above it through `TableToolbarSlot`.

Tactical [350](../tactical/350-share-links-and-private-hint.md) adds **Copy
share link** beside Copy magnet link in the More and row menus. The General
header's copy buttons run those same actions, so feedback is the shared
toast, and a private torrent shows "Private torrent: magnet and share links
only work for members of its tracker." under its status.

Tactical [349](../tactical/349-general-tab-compact-header-and-links.md)
replaces the General tab's summary card with one header line (name, copy
magnet link, copy share link), one status line and a thin progress bar.
Status, the Seeding row and the goals sentence collapse into that line and
a `Seeding goals` metric; speeds and peers become one metric each, and
Finished time shows only when it differs from Seeding time. Info hashes
gain a copy button. Share links are
`https://jstorrent.com/share/#<magnet query string>`, built from the
engine's magnet export; the website page that reads them is a follow-up.

Tactical [348](../tactical/348-torrent-list-export-import.md) adds a
**Torrent list** card to Settings → Data & reset (export, Save to, keep
matching folders, import with an inline summary) where the client supports
bundles, and lets the toolbar add several `.torrent` files or pasted magnets
with one progress and one summary toast.

Tactical [344](../tactical/344-seeding-stop-limits.md) adds **Stop seeding**
to Settings → Connection & seeding and to Torrent settings, renames the goal
group **Seeding priority**, and replaces raw-seconds and free-number fields
with preset pickers (`RatioPicker`, `DurationPicker`, `RateLimitPicker`) that
share `PresetPicker.module.css` and a `NumberInput` that draws units inside
the field. Every Settings control now ends on one right edge at one width.
A limit-stopped torrent reads **Seeding limit reached** and its single-torrent
start action reads **Keep seeding**.

Tactical [347](../tactical/347-about-on-every-web-host.md) makes Settings →
**About** universal. Every host shows how the page is connected, the version
(or "Not reported"), the build, and support links with diagnostics. Desktop
also shows its profile (build type and app ID), and the remote client shows
its own build. The category is titled **About & updates**, with the Updates
group, only where an updater exists. Diagnostics schema 2 adds connection,
identity, flavor and page build under the same allowlist and 2 KiB bound.

The header no longer shows a connection pill: the UI is connected unless it
says otherwise. Download and upload rates appear only while one is nonzero.
When the view stream to the engine has been down for 3 seconds, a blocking
**Connection lost** dialog covers the inert app and shows the next attempt
(**Trying again in N seconds**), **Retry now** and **Reload page**. The view
controller retries from 250 ms doubling to a 30-second cap; Retry now and
browser online/pageshow/visible wakes skip the wait. Authentication failure
stops retrying and asks to sign in again; contract, continuity and API
version failures stop and ask for a reload. Mounted state underneath is
kept, so an open form survives reconnection. The app root carries
`data-connection` (`connected`, `reconnecting`, `stopped`, `connecting`,
`demo`) for verifier scripts. Companion pages still unmount on their own
disconnect handling; this dialog covers in-app reconnects.

Tactical [340](../tactical/340-windows-quiet-network-startup.md) qualifies the
existing incoming/forwarding UI in the native Windows renderer. Forwarding's
short disclosure now refers to the operating system rather than macOS alone.
Collapsed Network details explains conditional firewall recovery after refusal
and that downloads work with incoming Off; it never reports an inferred denial
or grant. Full web tests/typecheck/localization/build pass. The CSS guard now
converts file URLs with `fileURLToPath` so its checks also run on Windows.

Tactical [339](../tactical/339-macos-quiet-network-startup.md) presents **Accept incoming connections** and
**Automatic port forwarding** in Connection & seeding. Ports appear only with
incoming enabled. Turning incoming off also disables forwarding in one patch;
enabling forwarding first shows a short explanation with **Not now / Enable**,
then uses the ordinary Save settings action. Listener status owns its row;
unavailable IPv6 is reported at IPv6 rather than as an incoming-setting failure.
The actual Mac renderer, draft/cancel/atomic-save cases and full web suite pass.

Tactical [334](../tactical/334-web-water-and-clay-visual-system.md) gives the
UI one visual system taken from the icon, "water and clay": warm neutrals,
one blue accent for selection and anything filling, clay for upload and
settled data, light and dark palettes in `global.css`. Component CSS may use
only those tokens, four radii and three weights; `src/style-guard.test.ts`
enforces this. Settings are grouped rows with switches and segmented
controls, and Library tiles are the icon's box filling with water to their
progress. Decorative gradients and uppercase eyebrow labels are gone.

Tactical [333](../tactical/333-web-settings-plain-copy.md) rewrites Settings,
the Torrent settings dialog and the General tab in user vocabulary.
Connection & seeding is grouped under Speed limits, Queue, Seeding goals,
Connections and Network headers. Rows show nothing when a setting applied,
`Applying…` while pending, and one localized line when it failed or the device
caps it. The former "Current runtime" block becomes a collapsed **Network
details** panel in whole sentences without engine detail. Speed limits use a
shared preset picker (Unlimited, 100 KB/s to 10 MB/s, Custom KB/s), replacing
the Unlimited-or-KiB/s field noted under Tactical 134; patches keep exact
bytes per second. 1024-based KB/MB/GB is the default size unit, and Decimal
remains an opt-in. Diagnostics tabs, Remote access, Web access and About copy
are unchanged.

Tactical [320](../tactical/320-chromeos-android-owned-extension-setup.md) makes
Android setup recoverable after cancel: Open JSTorrent Android is a direct
production-targeted link, while Connect in Chrome and Retry connection attach
only. The page exposes an explicit Allow Android connection action after denied
permission. Android owns setup and exact HTTPS return; foreground notifications
must be eligible before leaving Android. The credential-free website receives
only a UI-open receipt and has local-only assets/CSP without analytics. Both
physical candidate journeys, failure/expiry/restart and singleton checks pass;
public hosted/store delivery remains separate.


Tactical [313](../tactical/313-completed-remote-video-playback.md) adds a
closeable, keyboard-accessible remote video dialog with native media controls
and localized connection/buffering/error status. Files exposes **Play** for
completed MP4/M4V files; Library uses the same dialog. Existing local Open is
unchanged. Real Chromium decoded-frame/seek and visual capture evidence are
recorded in the tactical; this does not claim other containers or general
remote file opening. Tactical
[362](../tactical/362-local-browser-inline-playback.md) reuses the dialog for
local completed MP4/M4V/MKV in the browser-hosted UI. Files lists **Play**
before **Open**, Open keeps its new-tab icon, and the dialog header offers
Open in new tab as the fallback.

Tactical [310](../tactical/310-concise-first-use-and-background-setup.md)
reduces the shared first-use statistics dialog to a short explanation, plain
checkbox and privacy link. The full recipient warning stays in feedback
confirmation. Android separately presents folder-first setup and an explicit
background-download action, using the existing permission/preference owner.

Tactical [302](../tactical/302-desktop-external-links.md) repairs shared About
support and release navigation. Browser clients retain native isolated-tab
anchors; desktop bootstrap injects the official Tauri opener through a small
shared link provider. Desktop URL permissions cover only the approved support
and release destinations, and opening failures show generic localized retry
feedback. Engine/API/media authority and native Android/iOS presentation are
unchanged. Exact validation and native handoff evidence are in the tactical.

Tactical [301](../tactical/301-remote-save-progress-presentation.md) corrects
remote Save progress presentation in the shared Files surface. Save status,
bar, fixed-width tabular percentage and cancellation occupy a separate row;
narrow layouts put the phase label above the controls. Intermediate progress
updates at most five times per second, while terminal outcomes appear
immediately. Transport writes/acknowledgements, eligibility and remote Open/Play
scope remain unchanged. Web checks and isolated browser geometry evidence are
recorded in the tactical; deployment remains separate.

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

Tactical [290](../tactical/290-windows-installer-brand-artwork.md) corrects the
actual Windows NSIS generic artwork with original JSTorrent icons and blue/navy
welcome/header assets. Pinned schema/bitmap checks and26 release/trust cases pass;
actual non-installing native previews cancel normally with50-registry/seven-file
preservation and VM-off/release. Slice025 clearly distinguishes its presentation
harness from the signed a7 installer. Fresh original-signed Windows packaging
and focused installed/updater requalification remain required for these new
source inputs; old signed receipts retain their scope. No delivery occurs.

Tactical [286](../tactical/286-connected-companion-layout-review.md) qualifies
the actual controlled connected page at390/1100 and its narrow filter drawer.
An initial clipped image was captured during the drawer transition; settled
bounds show no page overflow or product-layout defect. The capture runner now
uses reduced motion and awaits actual bounds. Product presentation stays
unchanged; physical/store delivery remains a separate gate under259.

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

Topic: `web-ui-design`

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

Tactical [261](../tactical/261-linux-native-brand-name.md) repairs GNOME's
tray/accessibility fallback to the internal desktop executable name. The pinned
GTK/GLib binding initializes the human-readable JSTorrent name before desktop
or picker startup. Native Linux compilation, 73 tests and actual GNOME tray-name
observation pass. Rebuilt final signed Linux artifacts remain open.

The same historical signed ARM package repeats all eight manual migration
assertions and six refusal routes with normal native Quit and complete restored
state. Actual accessibility exposes four rows and an acknowledged disclosure,
and JSTorrent tray menu pixels render, while populated/restarted and refusal-
dialog captures remain unusable. Read-only alpha analysis finds zero RGBA
throughout the actual migrated/restarted native frame bounds; the cache probe's
active-window PNG is also entirely transparent. These captures cannot establish
the actual display pixels or a product design/rendering defect. Populated visual
acceptance remains open; the separate styled empty first-use probe cannot close
it. Recorded GVfs/module warnings and a separate spice-vdagent crash do not
establish its cause. Tactical259 retains original captures/adjudication plus the
alpha follow-up, with no graphics override or product change.

Tactical [274](../tactical/274-linux-arm-native-compositor-capture.md) checks
GNOME46's installed native default-encoder recording route without graphics
or permission overrides. Actual desktop/legacy window and native tray menus
are legible; migrated/restarted and refusal-dialog recording regions remain
almost uniformly black. The real old-writer helper repeats all eight assertions
and six refusal routes with full source/payload preservation and restoration.
This completes bounded capture investigation without closing visual acceptance
or establishing its cause. Final cleanup removes eight exact owned recording
URIs after delayed recent-file flush, verifies all recording roots absent and
serializes verified off/claim release.

Tactical [275](../tactical/275-linux-arm-signed-deb-visual-comparison.md) completes
the same historical source's original-signed ARM Debian native-payload comparison
using installed guest libraries and real old-writer fixtures. All eight migration
assertions and six refusal routes pass; actual native recordings and PNGs render
the populated/restarted JSTorrent library and both refusal dialogs. Four rows,
verified good/corrupt outcomes, missing-folder warning and acknowledged disclosure
persist. Source/payload preservation and full guest restoration pass. Exact owned
recording roots and six delayed recent entries are removed; VM off/claim release
are verified. This narrows the AppImage capture gap without establishing a cause
or qualifying package-manager installation, final source or installed updating.
The readable registration refusal exposes a raw filesystem error without a
recovery step, retained as a design follow-up.

Tactical [258](../tactical/258-cross-surface-branding-and-design-audit.md)
completes the broader branded surface audit with an
[audit execution record](../tactical/258-cross-surface-branding-and-design-audit.md). The website uses
the original JSTorrent box and blue/navy palette; Linux setup follows system
appearance, and the actual gateway handoff/bootstrap failure gain local branded
styles. Remote sign-in uses shared appearance preferences/palette and a scrolling
shell. Diagnostics use JSTorrent names; exact internal shell commands are
clipboard actions, with an accessible stronger-color release link. The final
53 browser capture states have no obsolete display brand, page-wide horizontal
overflow, uncaught page errors or serious/critical Axe violations. Demo and
mocked-platform rendering is distinguished from host/installed evidence.
Eight design/coverage follow-ups remain, including phone settings-category
discoverability, dense Linux help and native empty-state hierarchy.

Tactical 253 now opens the Linux library through the dedicated loopback
address `jstorrent.localhost:3030` by default. No alternate-connection choice is
needed. The existing bounded connection page retains exact-host permission,
service validation, Retry and Cancel. Setup explains the new address, paired
Linux package/extension updates, retained library, origin-local preferences and
preservation-safe troubleshooting. This replaces the earlier advice to use
Android indefinitely when Baguette hostname registration fails.

Tactical 253 implements portable pre-connection recovery: bounded discovery,
manual Retry/Cancel, joined view/connection cleanup, offline stage-specific
troubleshooting and explicit separate-library Linux guidance. A voluntary
allowlisted context preview keeps Play/app/policy unknown and excludes raw
errors and personal state. Six injected packaged-browser journeys, focused
ownership tests and the full 462-test web suite pass. Cohort A adds real
pairing rejection/retry/approval, shared-library recovery and offline guide
rendering using isolated candidate assets. Connected Android identity remains
visible. Reduced user-agent versions are labeled as such; actual browser/OS
builds remain unknown in support context. Observed rejection and the bounded
approval window have closed recovery categories. Pairing Cancel explains the
separate Android request's expiry; canceled UI startup joins its authenticated
client release before Retry. Final candidate assets also pass real declared-window
expiry, terminal cancellation, foreground unavailable-service recovery and the
explicit Linux guide link on cohort A. Full physical/store journeys remain
open; see the tactical for artifact and per-device limits.

Second-cohort physical Light/Spacious review found the connected Android
identity touching its troubleshooting link because anonymous whitespace is
collapsed between flex items. The existing companion header now has an explicit
0.75-rem gap. Its height and connection behavior are unchanged; 320/390/1200-pixel
headless layout checks preserve the 40-pixel header without horizontal overflow.
The full web typecheck, 462-test suite (two skipped) and packaged CSP checks pass.
After the full observation, the final packaged candidate also verifies the
12-pixel gap and 40-pixel header on the physical second Chromebook.

The same physical review exposed an unscrollable Speed panel in a short desktop
viewport. Its content extended beneath the application's clipped boundary.
Speed now owns scrolling within the existing detail-pane height, matching the
adjacent session panels. A 1200-by-631 wheel-input regression fails before the
fix and passes afterward, alongside the existing Speed selection/accessibility
journey. Physical wheel input also reaches the lower series controls while the
panel stays within the 631-pixel viewport. Data, series selection and
subscription behavior are unchanged.

The Linux follow-up adds a packaged offline connection page with a ten-second,
4-KiB exact-host health bound, explicit optional browser access and joined manual
Retry/Cancel. A failed fetch does not diagnose DNS or Linux/package/policy state.
Help explains normal Terminal startup and preservation-safe Linux shutdown.
Successful compatibility checks request fresh HTML to avoid an older installed
build's cached asset references. Existing connected warm handoff stays focused
without reload. Extension tests and injected packaged-browser/cache cases pass;
current isolated ChromeOS Linux browser file-picker bytes verify independently.

Accepted 2026-10-01, not yet qualified: Tactical
[253](../tactical/253-chromeos-onboarding-recovery-and-physical-qualification.md)
prioritizes ChromeOS troubleshooting from the pre-connection extension screen
as well as the connected product. Show the known failed stage, one next action
and manual Retry/Cancel. Unreachable Android is not proof Play is disabled or
the app absent. Offer an explicit Linux setup route when Android installation
or connection is unavailable, explain its separate library, and give an honest
unsupported outcome when neither host is available. Both physical devices
must qualify these journeys; existing popup rendering tests do not suffice.

Tactical [249](../tactical/249-jstorrent-brand-and-extension-refresh.md) restores
JSTorrent display names and the original blue-box icon in the shared header,
authentication gates, browser favicons and packaged connection screen. The
extension popup uses blue accents, system light/dark appearance, a primary
Android Chromebook choice and an expandable separate Linux preview. Returning
users expand privacy settings; first-use disclosure stays visible. Torrent list,
detail/navigation structure, appearance preferences, commands and consent policy
remain unchanged. Twelve isolated popup platform/theme/privacy states and four
existing shared responsive/accessibility/appearance browser tests pass. A broader
JSTorrent library/detail/settings design review remains a follow-up.


Tactical [248](../tactical/248-chromeos-staggered-upgrade.md) adds actionable
ChromeOS mixed-version guidance: an old Android service requires an app update
with Google Play and Retry; an incompatible new protocol requires an extension
update. Unavailable service guidance explains direct Android use while updates
arrive. The packaged page never starts a legacy engine or old control fallback.
Controlled API 28/35 browser rehearsals render and control the migrated Android
library after fresh pairing; production store replacement remains separate.

Tactical [244](../tactical/244-unavailable-storage-presentation.md) corrects
shared React adaptation of `awaiting_storage`: blocked progress becomes Needs
attention with a Storage unavailable table label; active storage preparation
retains active membership. Existing typed progress and operational state remain
authoritative. Application DTOs, persisted run intent, root health and checker
behavior are unchanged. Adapter/category/component and migration regressions
pass; Android Compose uses operational state and does not share this mapping.

Tactical [`236`](../tactical/236-desktop-compatibility-refusal-and-recovery.md)
shows update guidance and Retry connection after an incompatible desktop
bootstrap/handshake. Authentication failures also require manual attach-only
retry. Automatic retries stop, stale application controls are hidden/unmounted,
and no internal error-code prefix appears. A stopped runtime still offers Start.
The packaged Linux browser refusal/repair and beta compatibility matrix pass;
this is not a signed installer or store-update qualification.

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

Tactical [`232`](../tactical/232-desktop-extension-control.md) mounts the same
React library in the desktop extension with portable multi-root presentation.
Its bootstrap shows Start when the desktop is stopped and offers Open desktop
window. Reconnection only attaches; a disconnected application is unmounted
and hidden so stale rows cannot accept actions. Qualified Linux, Windows and
macOS builds expose the authenticated desktop-owned folder picker in this same
UI. Cancellation adds no root; disconnect and Quit cancel its owned helper.
The platform frame carries an optional opaque repair-root ID, never a path.

Tactical [`229`](../tactical/229-web-desktop-data-reset.md) adds a Data & reset
Settings category with separate confirmations for restoring default preferences
and clearing local app data. Downloaded files stay by default; an unchecked
opt-in uses the existing exact per-torrent delete path. Failure keeps the
confirmation available for retry.

Tactical [`230`](../tactical/230-desktop-stable-latest-update-channels.md)
adds a Stable/Latest selector to desktop About and Updates. It explains check
cadence and shows when Stable must catch up after a newer Latest installation.
The control is absent on browser/headless and package-manager surfaces.

Tactical [`228`](../tactical/228-settings-category-selection-style.md)
replaces the Settings category rail's selected edge bars with a simple
full-item tint. The keyboard focus outline remains distinct from selection.

Tactical [`227`](../tactical/227-stable-remove-dialog-controls.md) keeps the
Remove torrents dialog and its footer controls stationary when the user
toggles downloaded-data deletion. It reserves the conditional warning's
space and the longest confirmation-label width while retaining the warning
and destructive-action wording only when selected.

Tactical [`226`](../tactical/226-live-webui-hot-reload.md) adds optional
live UI hot reload to `./scripts/webui --reload`. Vite owns the visible
loopback page and source updates; the gateway keeps the live application,
persistent profile, and picker behind same-origin proxy routes. The ordinary
launcher retains its production-built behavior.

Tactical [`225`](../tactical/225-two-destination-torrent-navigation-first-pass.md)
puts a Library/Torrents navigation first pass up for product review. Torrents
uses the detailed Workbench surface and is the fresh-install default. Saved
Transfers destinations open Torrents with their previous filter. At narrow
widths, row activation opens detail, the checkbox stays in the list for
batch actions, and detail has a prominent return button. The historical
three-destination implementation record below is retained for context.

Tactical [`216`](../tactical/216-local-support-diagnostics-and-release-baseline.md)
adds the About support report with an explicit immutable preview, copy/manual
fallback/download, and no-context issue links. The 320/1440-pixel light/dark
matrix has no horizontal overflow or serious/critical Axe findings; users
review exactly what they copy or download before public submission.

Status: Product, presentation, application-view, and client-store direction
accepted. Completed direct-storage Tactical
[`191`](../tactical/191-direct-filesystem-storage.md) removes
`published`, `not published`, waiting-for-publication, and RSTorrent-managed
storage wording, replaces the removal choice with plain keep/delete downloaded
files, and exposes independently completed wanted files. The existing UI
history below remains as an implementation record. Tactical `033` implements
the generated contract, polling client,
lifecycle controller, and pure reducer. Tactical `034` implements the fresh
React/Zustand/CSS Modules application, adaptive inspection hierarchy, virtual
tables, and permanent named demo adapter.

Completed Tactical
[`201`](../tactical/201-durable-seeding-goals-and-seed-admission.md) extends
**Connection & seeding** with backed active-seed, share-ratio,
finished/download-time, and finished-time priority values. Semantic Unlimited
disables only the count input; explanatory copy states that meeting any goal
lowers priority and does not stop the torrent. Summary and detail surfaces use
authoritative active/queued/goal state. Wide and 390-pixel Playwright cases
prove defaults, Unlimited, exact active counts, no horizontal overflow, and no
serious or critical Axe violations.

Tactical `035` connects stable Rust
torrent and active-peer projections through semantic responsive view
selection while retaining the demo adapter and recovering cleanly after
browser suspension. Tactical `036` adds the production-built manual live
browser launcher. Tactical `037` adds accessible, responsive magnet intake to
the live toolbar and routes it through the semantic application command while
retaining the permanent demo adapter. Tactical `038` adds a keyboard, pointer,
touch, and phone-safe More > Add test torrent submenu backed by the recorded
WebTorrent catalog and the same add path. Tactical `220` adds an explicit
**Add all sample torrents** item to that submenu. It submits the five catalog
magnets sequentially with one shared download-options choice, keeps the batch
busy across Transfers and Workbench navigation, and reports added, already
present, and failed counts. Tactical `040` adds live archive and
an accessible removal dialog whose managed-data option is unchecked by
default. The docked detail inspector is now bounded and resizable by pointer,
touch, or keyboard. Tactical `041` adds the first live Files surface, exact
sorting, persistent table columns and widths, and a 4,096-row named scenario.
Completed Tactical
[`173`](../tactical/173-mobile-web-table-horizontal-scrolling.md) makes those
configured columns authoritative at every viewport width and restores trusted
touch horizontal scrolling across every shared table. Tactical
[`256`](../tactical/256-swarm-touch-ci-stabilization.md) stabilizes the swarm
layout CI journey with native touch-event timing, a stationary release and an
observed `scrollend` before position/resize assertions. The current Linux
headless probe acknowledges synthesized gestures without touch-move events;
the native route is independently exercised there. Every scrolling,
column-bounds and accessibility oracle remains. Pressured
repeats and the full local browser suite pass. The tactical links its receipts.
The subsequent desktop release source gate exposes a separate external-intake
unit-test race: command submission precedes its asynchronous completion.
Await the existing success message and empty-queue observations together;
all 470 unit tests (two skipped) and typecheck pass locally. Final source
f5860c99 passes all ten executed CI jobs and Website; application behavior
is unchanged.
Tactical `043` adds the responsive live Trackers table, local deadline
countdowns, and a permanent tracker-recovery scenario. Tactical
[341](../tactical/341-trackers-tab-peer-sources.md) adds an **Other sources**
list above it (DHT, Peer exchange, Incoming connections, and Local network
when it supplied peers) with plain status and known/connected counts from the
swarm and DHT views, which the Trackers tab now also subscribes at 1 s. Completed Tactical
[`300`](../tactical/300-monotonic-tracker-view-deadlines.md) fixes countdown
oscillation by translating stable application-monotonic deadlines once per
view-set epoch. Component tests cover expiry, outcome ages and calendar-clock
jumps; a permanent real-gateway/browser runner checks unrelated updates, tab
reopen and reload with sampled countdown values and a reviewable screenshot.
Tacticals `044`--`045`
add the global Disk pipeline and selected-torrent bounded Canvas Pieces
overview, including responsive and large-torrent fixtures. Completed Tactical
[`187`](../tactical/187-compact-metadata-acquisition-progress.md) adds a
smaller selected-only General card using the same bounded-Canvas principle for
BEP 9 metadata blocks: native progress semantics, a text legend, and scalar
peer/request/retry facts without one DOM element per block. V1, v2, and hybrid
share that map; a separate v2/hybrid integrity card reports active or waiting
and counts without inventing percent. Wide and phone browser assertions plus
visual inspection cover the permanent stalled-metadata demo. Tactical `047`
adds the global Settings sheet and versioned Compact, Standard, and Spacious
interface sizes, makes readable Standard the default, and keeps virtual-table
geometry coherent with presentation sizing. Tactical `048` replaces the
legacy Tauri entry with the same React inspection application using
acknowledged in-process leased-view streaming. Tactical `060` now gives the
ordinary browser one multiplexed WebSocket for all calls and view sets,
retains HTTP only through the explicit `transport=http` loopback diagnostic
query, deletes the superseded direct-DOM gateway entry, and makes the modern
named demo the no-mode root. Tactical `049`
completes the accepted
global Logs design: a dedicated virtualized chronological console with
structured expansion, separate capture and display filters, bottom-follow/
new-record behavior, local clear, and no sorting or persistence. Tactical `050`
adds Auto, Light, and Dark to the shared Appearance settings, safely migrates
the size-only preference, and applies persisted theme before React content.
Tactical `051` replaces ambiguous peer flag strings with typed Rust semantics,
one exhaustive React glyph/label table, full cell accessibility, and a
separate sortable-header help control containing a compact sectioned
glyph/name legend without explanatory prose.
Tactical `056` completes the existing Peers Client column: the Rust
application projection supplies a bounded client/version label derived from
the handshake peer ID, while React retains only nullable display, title, and
sorting behavior and shows an em dash for unknown evidence.
Tactical `103` adds the already-contracted Up, Uploaded, Connected, and Last
payload facts to the sortable responsive Peers table. Existing persisted
column preferences accept the new identifiers without a version migration;
directionally unsupported values remain em dashes.
Completed Tactical
[`104`](../tactical/104-selection-aware-torrent-eta.md) replaces the live
Workbench ETA placeholder and adds the same value to Transfers. Rust supplies
exact decimal strings and a tagged warming/estimate/stalled/unavailable
state; React performs only arbitrary-precision formatting, stable semantic
sorting, and accessible `—`/`∞` presentation. File ETA and richer priority
controls remain deliberately absent.
Completed Tactical
[`106`](../tactical/106-live-transfer-rate-tab-title.md) adds the familiar
session transfer rates to the browser/Tauri document title. A separate
two-metric session-speed projection updates at one-second cadence regardless
of destination or selected Speed series; idle and disconnected sessions
retain plain `RSTorrent`, and the active Decimal/Binary preference applies. A
leading/trailing throttle separately guarantees that React applies rate-driven
title changes at most once per second while retaining the latest pending
rates.
Tactical `055` implements the accepted product information architecture:
responsive Library, Transfers, and Workbench destinations; contextual
sidebars; shared bounded multi-selection; a clean transfer queue; a truthful
torrent-backed content grid; and collection-only application-view leasing
outside Workbench. The detailed surface remains intact as Workbench, as
recorded in
[`application-interface-direction.md`](application-interface-direction.md).
Completed Tactical
[`072`](../tactical/072-derived-media-catalog.md) makes normal Library card
activation open a responsive read-only torrent detail. Media defaults to
recognized videos ordered by typed episode values; All files is an explicit
fallback. Same-document history, Back, Escape, focus return, collection scroll,
filter/removal repair, and visible-projection-only leasing remain local to the
Library owner. Wide layout places source summary beside a virtual list;
compact and phone layouts stack and use smaller generated placeholders without
claiming artwork. Thumbnails, playback, and Library-wide aggregation remain
separate decisions.
Tactical [`223`](../tactical/223-remove-library-capability-notices.md)
removes capability-status copy from the Library sidebar and empty state while
retaining the functional filters and result message.
Tactical `058` replaces persistent torrent checkboxes with a discoverable
selection mode, separates the current torrent from batch command targets, and
applies the same interaction locally to Files. It initially staged disabled
file actions without claiming runtime mutation support.
Tactical `059` restores a permanently reserved checkbox column specifically on
actionable tables and adds sorted Shift-range selection without recoupling the
current row and batch command set. Tactical `063` activates that Files-local
selection with exactly `Normal` and `Skip`, and keeps Add limited to root plus
one checked-by-default start-content option. The accepted successor interaction
contract now lives in [`table-interaction.md`](table-interaction.md): it names
the singular detail-owning row as active, names checked command targets as the
batch selection, makes row focus follow active navigation, and adds
Shift+Arrow plus platform select-all as pending implementation work.
Completed Tactical
[`108`](../tactical/108-serialized-torrent-control-and-observable-checking.md)
adds a distinct checker-progress model before the Files surface gains
`Download now`. While a torrent checks, Library and the transfer progress cell
show determinate checked progress when hashing and truthful queued,
preparing, storage-reconciling, paused, or finalizing text otherwise. The
selected summary exposes exact counters and bounded liveness. The shared
component does not reuse old durable download completion as current check
progress or reconstruct activity with a React timer. Deterministic component
coverage and a Chrome/Axe lifecycle scenario exercise Transfers, Library,
Workbench, and the selected summary.
Completed Tactical [`110`](../tactical/110-atomic-download-now.md) adds one
`Download now` action to both existing Files menus when at least one target is
skipped. It submits one semantic wanted-plus-running command and waits for
authoritative file and torrent views rather than mutating rows optimistically.
Mixed selections submit one sorted target set; the action is not a high or
streaming priority.
Tactical [`111`](../tactical/111-mse-peer-stream-encryption.md)'s implemented
slice adds a four-option **Protocol obfuscation (MSE/PE)** control to the
existing Connection & seeding section. Its helper says the setting improves
compatibility and is not privacy or security. The ordinary settings draft,
refresh, equality, save, and keyboard paths use the generated closed enum and
authoritative configured/effective/application state. The Peers legend now
labels `E` as "Encrypted or obfuscated" for both MSE payload methods rather
than inferring encryption strength in React.
Completed follow-up Tactical
[`115`](../tactical/115-mse-policy-advertisement-and-peer-detail.md) keeps that
same glyph, column width, sort value, and generic legend. Only the existing
cell tooltip and accessible name refine `E` to plaintext-payload MSE or RC4
when the optional exact method is present, so ordinary scanning stays quiet.
Tactical `071` adds a presentation-only **Copy magnet link** More action for
exactly one selected torrent. It synthesizes the canonical v1 URI from the
already projected info hash, reports actual clipboard success or failure, and
does not claim byte-for-byte preservation of the submitted source URI.
Completed Tactical
[`107`](../tactical/107-source-aware-magnet-export.md) supersedes that lossy
construction without putting source text in torrent rows. More and row-context
copy now request an explicit read-only application export for every stable
selection target, preserve a verified retained magnet byte-for-byte, and
otherwise receive a bounded `xt`/verified `dn`/ordered `tr` synthesis. The
shared action still performs one newline-delimited clipboard write and now
reports any tracker omissions required to keep the result usable.
Tactical `077` replaces the four component-local popup implementations with a
shared portalled overlay layer. File actions, torrent More and its submenu,
table Columns, and column help now share collision-aware positioning,
dismissal, focus restoration, keyboard semantics, layering, and responsive
bounds while retaining visible actions and existing targeting policy.
Tactical `083` makes empty Add synchronously open a hidden single-file
`.torrent` chooser in the same shared browser/Tauri toolbar. Nonempty input
retains magnet validation. The existing root/start dialog owns options while
the component retains only the browser `File`; bytes are read when the add
begins and no filename, path, digest, or progress percentage enters
presentation state.
Tactical
[`100`](../tactical/100-bep53-select-only-and-duplicate-add-feedback.md) makes
new and duplicate add outcomes consistent: a typed result selects and reveals
the affected torrent and reports added, already-present, or BEP 53 selection-
expanded status through the existing polite live surface. A plain duplicate
does not open a merge prompt. Programmatic reveal retains Add DOM focus and
does not open detail; Compose presentation parity is outside that slice.
Tactical `085` unifies selection-scoped toolbar, More, and row-context actions.
Transfers and Workbench expose full-selection Start, Pause, Force recheck,
Copy magnet links, Archive, Restore, and coordinated Remove; Files exposes the
same Normal/Skip policy from More and its row context menu. One application-
lifetime torrent owner keeps sequential progress and multi-remove state alive
across destination changes. Tactical `221` removes visible category headings
from those action menus and keeps subtle dividers only between nonempty
groups, retaining their order and availability.
Completed Tactical
[`101`](../tactical/101-first-run-web-authentication.md) graduates the narrow
single-column Settings sheet into one adaptive modal workspace with Appearance,
Downloads, Connection & seeding, and capability-gated Web access categories.
Desktop/tablet uses a category rail and phone layouts use a compact horizontal
category control. Existing panels retain their own commit semantics while Web
access owns immediate browser approval, session listing and revocation,
sign-out, and restart-pairing recovery. Tauri, demo, Basic-only, and bearer
surfaces do not show an inert cookie-session category.

Completed Tactical
[`192`](../tactical/192-production-owner-relay-access.md) adds a distinct
capability-gated **Remote access security** category rather than overloading
that loopback **Web access** panel. This first implementation is exercised only
from the release-built bundle at a distinct loopback HTTPS origin and does not
become a published surface. After the first successful remote password
login, the browser offers an explicit primary **Private browser — stay
authorized** choice and a secondary **Shared browser — this page only** choice.
A returning private browser shows bounded connection progress while it attempts
challenge-bound resume before presenting the password form; transient route
handoffs retry and unexpected authenticated transport loss reloads into the
same resume path. Expiry or ordinary resume rejection explains that the
password is required, while host-identity mismatch remains a separate blocking
warning.

The security category is available to local desktop/headless administration
and the authenticated remote capability profile. It shows every current
authorized browser before retained expired/revoked history, marks **This
browser**, exposes resume deadlines and live circuits, and offers rename,
individual revoke, **Revoke all other browsers**, **Require password on every
browser**, current-browser sign-out and explicit history clearing. A second
bounded activity section distinguishes full password login, automatic resume,
authorization changes, circuit open/close, relay status and aggregated failed
attempt pressure. Destructive actions identify exactly which live circuits and
future resumes they terminate, require proportionate confirmation and report
completion only after server-side invalidation. Client-supplied labels and
browser descriptions remain escaped bounded display metadata, not trust
badges.

Tactical
[`178`](../tactical/178-crostini-storage-guidance.md) applies the same
capability-gating rule to storage help. Only an exact `rstorrent-crostini`
health identity adds a collapsed Chromebook storage explanation to Add and
Downloads Settings. It recommends Linux Downloads, provides the complete
ChromeOS **Share with Linux** workflow on expansion, and labels only known
Linux-Downloads and `/mnt/chromeos` roots. Other browser, headless, Tauri, and
demo surfaces do not receive path-derived ChromeOS copy.

Completed desktop-notification Tactical
[`164`](../tactical/164-desktop-completion-and-attention-notifications.md)
reuses that capability-gated category model for a Tauri-only
**Notifications** section. React receives only a narrow controller for three
typed shell preferences; native Rust derives and submits notification content.
Browser, demo, remote web, Android, and iOS surfaces omit the category rather
than rendering unsupported controls.

Completed sleep-inhibition Tactical
[`165`](../tactical/165-cross-platform-active-download-sleep-inhibition.md)
adds a separate Tauri-only **Power** category through the same capability
model. Its one accessible default-on switch saves immediately, rolls back with
visible status on failure, and explains that display blanking remains normal.
Browser and demo routes omit the category; Android presents its native setting
in Compose and iOS deliberately presents no equivalent control.

Completed Tactical
[`134`](../tactical/134-hierarchical-transfer-rate-enforcement.md) adds All
torrents peer upload/download controls to Connection & seeding and a
per-torrent pair, now presented in the Torrent settings dialog by Tactical
[`222`](../tactical/222-torrent-settings-dialog.md). Both reuse one semantic Unlimited-or-KiB/s
field, retain the last valid finite value across toggles, state the counted
peer-traffic scope, and wait for authoritative command/view updates. Component
tests cover bounds, exact bytes-per-second conversion, effective state, and
error handling; headless Chrome proves wide, compact, and phone interaction,
keyboard toggling, retained input, save feedback, and zero serious/critical
Axe violations.

Tactical [`222`](../tactical/222-torrent-settings-dialog.md) moves the
per-torrent editor out of Workbench General detail. The shared Torrent
settings action opens one dialog from a torrent row context menu or the More
menu. It requires exactly one selected torrent, keeps the existing sparse
settings draft and command behavior, and returns focus to the invoking
control on dismissal.

Completed Tactical
[`180`](../tactical/180-typed-settings-patches-and-draft-convergence.md)
replaces prop-to-form synchronization in both settings editors with one pure
typed draft reducer/hook. Torrent upload and download are independently dirty
and independently patched; any current client-settings subset shares the same
model. A receipt moves captured fields to awaiting-view, and only matching
authority at or beyond the accepted durable revision clears them. Continuous
autoplay, reset, conflict, failure, and edit-while-pending tests no longer
depend on sparse delivery or retained object identity.

Completed Tactical
[`138`](../tactical/138-verified-http-file-serving.md) presents `Open` only for
Files rows whose producer-owned media availability is `available`. Browser
mode synchronously reserves an opener-isolated tab before requesting the
ephemeral URL and closes it on typed failure; Tauri delegates the same result
to its validated system opener. Tests cover visibility, call routing, popup
isolation, failure cleanup, WebSocket/Tauri adapters, URL rejection, and live
state. There is no embedded player, copied URL, MIME-specific action, or
client-derived eligibility.

## Purpose

The shared browser and Tauri client should become RSTorrent's detailed
product and inspection surface without inheriting JSTorrent's frontend
architecture. It must remain useful as a dense desktop torrent client while
also adapting gracefully to small desktop windows, touch input, tablets, and
phone-sized browser viewports.

This topic owns the web presentation technology, information hierarchy,
adaptive navigation, styling, accessibility, and performance direction. The
broader reason for prioritizing the surface remains in
[`desktop-inspection-surface.md`](desktop-inspection-surface.md). The accepted
semantic application-view, view-set, polling, streaming, codec, and generated
contract direction lives in
[`application-view-api.md`](application-view-api.md).

## Terminology

Unqualified **UI** and **web UI** mean this mature shared React product
application, whether it is hosted in a browser or embedded by Tauri. Tactical
`060` retired and removed the earlier direct-DOM proof, so it is not a second
current web UI. The platform-specific Compose presentation is named
explicitly as the **Android**, **Compose**, or **Android UI**. The Astro
`website/` tree is the project website, not this product surface.

## Fresh Frontend

Build a fresh frontend rather than transplanting the current JSTorrent React
and Solid component tree. JSTorrent remains the primary product reference for
visual density, terminology, familiar actions, information hierarchy, and the
set of detailed views. Its mutable engine objects, mixed-framework rendering,
controller topology, and transport assumptions are not compatibility targets.

Use the stable React `Latest` release available when the implementation
tactical opens. React does not publish a conventional LTS channel. Pin the
selected stable release in the lockfile and do not adopt Canary, Experimental,
server components, or a full-stack framework without a demonstrated product
need. The shared client remains a strict-TypeScript, client-rendered Vite
application.

Component styling uses CSS Modules. Global CSS is limited to normalization,
design tokens, typography defaults, theme variables, and other genuinely
application-wide rules. Layout and component states belong in colocated
`*.module.css` files. Inline styles are reserved for measured or data-driven
geometry such as virtual-row transforms and column widths, preferably through
CSS custom properties.

Use the stable Zustand v5 release available when the implementation tactical
opens and pin the exact version in the lockfile. Use its vanilla store as the
application-state owner and its React bindings for narrow selectors. No
routing, design-system, or data-grid library is selected by this topic. Each
dependency must solve a concrete need and preserve strict typing, headless
testability, accessibility, and bounded rendering.

Tactical `077` accepts exact `react-aria-components` `1.20.0` as the focused
unstyled overlay and menu dependency. Direct library composition remains
inside one local wrapper rather than becoming feature-component policy.
RSTorrent still owns styling, appearance tokens, labels, command eligibility,
and tests; React Aria owns the difficult portal, positioning, menu, submenu,
focus, and dismissal mechanics. Do not add a parallel overlay package or the
styled React Spectrum system without new measured evidence.

## Information Hierarchy

Preserve JSTorrent's recognizable torrent detail hierarchy: overview,
trackers, peers, swarm, files, and pieces remain torrent-scoped views. Disk is
a session concern because its pressure and scheduling capacity are shared even
when rows retain torrent attribution. Logs, transfer speeds, DHT, Disk, search,
settings, and other session or product concerns use an identifiable right-side
global group. The accepted storage and piece split lives in
[`disk-and-piece-inspection`](disk-and-piece-inspection.md).

The accepted detail-tab sequence is complete. Tactical
[`064`](../tactical/064-registry-backed-swarm-inspection.md) now makes Swarm a
bounded, virtualized table over retained registry records while Peers remains
active connections. One central tab vocabulary owns torrent/session scope,
and the `swarm-lifecycle` plus 1,000-row fixtures cover state legibility,
responsive layout, accessibility, and bounded rendering. Completed Tactical
[`175`](../tactical/175-retained-swarm-peer-transfer-totals.md) makes exact
retained-record **Downloaded** and **Uploaded** payload totals default-visible
and arbitrary-precision sortable beside retry state. Column help distinguishes
useful content from protocol traffic and states that counters reset with the
engine or record; all configured columns remain reachable at 390 and 456
pixels. Completed Tactical
[`065`](../tactical/065-dht-observatory.md) makes DHT a
session observatory led by a static shared-prefix-depth distribution with
mirrored replacement occupancy, freshness, a truthful deeper-band summary, and
bounded lookup-convergence rows. An optional presentation toggle shows the
literal 160-slot engine array using the same observation, making the normalized
encoding teachable and screenshots diagnostic without introducing chart
inspection as required interaction. No force graph, globe, or raw node table
enters the slice. Its permanent fixture and browser evidence cover lifecycle,
sparse and ordinary occupancy, active convergence, malformed and rate-limited
traffic, a nonzero deeper tail, stale delivery, terminal state, both encodings,
narrow layout, and light/dark accessibility.
Completed Tactical [`066`](../tactical/066-smooth-session-speed-history.md)
makes Speed a session-owned range-selected history rendered by local high-DPI
Canvas code.
Payload download and upload are the default solid series; staged-write,
verified, and traffic-class series are opt-in, and a reset restores the
default range and selection. Coarse
rollups persist separately from correctness-critical session state, RAF smooths
and pans only between exact live anchors, and no general chart dependency is
selected.

Use three top-level application destinations rather than making one sidebar
carry product navigation, torrent filtering, and media organization:

- Library is content-centric media browsing and eventual playback;
- Transfers is the clean operational torrent queue; and
- Workbench preserves the current dense torrent table, detailed tabs, and
  global diagnostic surfaces as a first-class traditional interface.

The accepted responsibilities, continuity rules, media-truth boundary, and
local mockup record live in
[`application-interface-direction.md`](application-interface-direction.md).
The sidebar is contextual to the active destination. Torrent lifecycle filters
such as active, downloading, seeding, completed, paused, and errors therefore
belong to Transfers and Workbench rather than being described as a media
library.

The resulting conceptual hierarchy is:

1. application and session;
2. Library, Transfers, or Workbench destination;
3. destination-specific category, filter, and organization;
4. media or torrent collection and selection;
5. selected item and its contextual or Workbench detail views; and
6. progressive detail for a peer, file, tracker, piece, or other selected row
   when useful.

Archive is not deletion. Tactical `316` decides its relationship to pause:
an archived torrent is paused and cannot be started, queued or given Download
now until it is restored, and Restore leaves it paused. Archived torrents
appear only in the Archived category on every surface; All excludes them.
Content retention and queue position are unchanged by archiving. Durable
categories and labels belong above browser-local presentation state.

## Adaptive Navigation And Layout

Use one navigation and view model across sizes rather than separate desktop
and mobile-web applications. Layout responds primarily to available space and
input capability, not a platform or user-agent label.

On a wide display, the category sidebar may remain visible and the torrent
list may coexist with a docked, resizable detail inspector. A selected torrent
may also enter a focused detail mode when the user wants more room for peers,
files, pieces, or another dense view.

The implemented horizontal separator retains its size in per-application
presentation state, exposes range semantics to assistive technology, supports
Up/Down and Home/End keys, and accepts pointer or touch dragging. Its bounded
25--80% range protects useful space for both collection and detail content.
The preference is not yet persisted across application reloads.

As space narrows, the sidebar becomes collapsible, a rail, or a drawer. The
torrent list and detail inspector may stop sharing the viewport. At phone
widths, selecting a torrent navigates to a full-size detail view with a clear
back action. Returning to the list preserves useful context such as category,
filter, sort, selection, and scroll position.
Tactical [`224`](../tactical/224-workbench-detail-back-breakpoint.md) aligns
that back control with the 760 px width where Workbench hides the list, so
the 701–760 px range retains the return path.

Tactical [`351`](../tactical/351-narrow-web-lists-and-flat-chrome.md) makes
760 px the single narrow breakpoint (`NARROW_MAX_WIDTH` in `layout.ts`,
repeated by stylesheets) for the store's `phone` layout, the drawer, the
detail app bar and list rendering. The sidebar owns navigation at every
width: Library and Torrents, then the current destination's categories, and
in the narrow drawer the session views. Library and Torrents form a
full-width segmented switch, styled like the Settings choices, so they read
as a view toggle rather than as peers of the categories below. Switching
destination keeps the drawer open because the categories it reveals are
usually the next choice; choosing a category or session view closes it. The
narrow header is one row (menu,
logo, current place, Settings). A narrow torrent or Library detail replaces
it with an app bar: back arrow, name, Pause or Start, and a ⋮ menu of the
remaining torrent actions. Narrow torrent details show torrent tabs only;
session views open from the drawer and stand alone.

At narrow widths tables render as Android-style list items rather than
sideways-scrolling grids. Each table declares which columns form the title,
trailing value, subtitle, wide line (such as progress) and labelled details;
other columns appear only at wider widths. Sorting moves to a Sort field.
This deliberately narrows Tactical 173's narrow-width column guarantee: the
complete columns stay available above 760 px.

Content surfaces are one plane. Only the header and sidebar are tinted;
column headers, the tab bar and the splitter use the content surface with
soft borders. A table's count, selection status and Columns share the bar
above it (action bar, tab bar or Files summary) instead of adding a row.

The same torrent and detail components should serve docked and focused modes.
Navigation state must remain understandable and restorable rather than being
encoded only in incidental component state. The exact URL and routing scheme,
default wide-screen inspector placement, and whether users can choose between
bottom and side docking remain open.

Touch is a first-class input. Primary actions cannot require hover, right
click, or a fine pointer. Context menus may complement visible or otherwise
discoverable actions but cannot be their only access path. Density may adapt
without removing information or making controls too small to operate.

Anchored action menus and popover dialogs render through a body portal so
application and table overflow cannot clip them. They keep an 8-pixel viewport
boundary, flip and shift with available space, inherit root theme and
interface-size tokens, and stay below modal dialogs. At narrow phone widths a
nested menu divides usable width with its parent rather than rendering off
screen or covering the parent. Escape restores the relevant trigger; Tab
continues through document focus order. The first outside tap dismisses only
and does not also activate the obscured control. The shared trigger supports
desktop context invocation. Tactical `085` binds it only to actionable torrent
and file rows; visible toolbar/More actions remain the primary touch path and
touch/pen long press remains additive selection.

The continuing actionable-table interaction contract lives in
[`table-interaction.md`](table-interaction.md). Tactical `069` implements its
current-within-selection model: one singular current row owns detail and is
always checked, while every checked row is an action target. Row-body and bare
keyboard navigation collapse to one current row; checkbox, modifier, range,
and select-all gestures build the selection. Actionable tables retain visible
checkboxes; read-only inspection tables do not gain batch behavior without row
actions. Tactical `070` makes an error-bearing torrent status a nested
explanatory control without disturbing those row gestures. Hover exposes its
bounded error, keyboard and assistive technology receive the same context, and
activation establishes a singleton current row before opening and focusing the
General error detail. Tactical `085` adds right-click, Context Menu key, and
Shift+F10: a selected row preserves the complete checked set, while an
unselected row becomes the singleton target before the menu opens.

Torrent-detail tab selection is a paint-only state change. Labels retain the
same font metrics, the underline is out of layout flow, and every tab has the
same fixed footprint for the selected interface size. Navigation labels do not
carry counts; the corresponding detail content owns row totals and summaries.
The divider before Disk continues to distinguish torrent-scoped from
session-scoped views; session tabs follow it rather than being pushed to the
far end, so the table controls sharing the tab bar never move a tab.
Selecting or evicting a detail view therefore cannot move neighboring tabs,
while constrained layouts retain one horizontally scrolling row rather than
shrinking or wrapping the tabs.

The responsive web application does not replace the native Android Compose
product or create automatic UI parity with it. Phone usability applies to the
shared web surface itself, including small desktop windows and future browser
access.

## Action Feedback

Tactical [`346`](../tactical/346-action-feedback-toasts.md) sets one rule
for action results. A result already visible on screen (a priority column, a
paused row, a ticked setting, a folder in the list) gets no words. A result
that is off screen or otherwise unconfirmed uses one bottom-centre toast
modelled on the Android snackbar: one slot, a new toast replaces the current
one, info toasts close after 4 s (10 s with an action), and hovering or
focusing pauses them. Errors stay until dismissed or replaced; form and field
validation stays beside its control. Easy reversals offer an action on the
toast: archive and restore offer Undo, and adding a torrent that is already
archived offers Restore. Inline rows that appear only to report a result are
not used, because they move surrounding content. Ongoing state such as
waiting for Wi-Fi, an available update, or buffering is status, not a result,
and stays where it is.

## Accessibility

Accessibility is an initial correctness requirement. The new implementation
must not reproduce JSTorrent's dependence on generic `div` grids, color-only
state, hover-only discovery, or incomplete focus semantics.

- Use semantic elements and appropriate grid, table, tab, navigation, dialog,
  status, and live-region semantics.
- Make all navigation, selection, sorting, resizing alternatives, menus, and
  torrent commands operable by keyboard.
- Preserve and restore focus across dialogs, responsive layout changes, and
  list-to-detail navigation.
- Expose selection, sort order, current tab, progress, stale or unavailable
  data, errors, and disabled actions to assistive technology.
- Maintain useful contrast in all themes, never rely on color alone, honor
  reduced-motion preferences, and remain usable under browser zoom and larger
  text.
- Provide touch targets and spacing appropriate to coarse pointers without
  forcing desktop users into one permanently oversized density.

Automated semantic and accessibility checks, keyboard-driven browser tests,
and manual screen-reader spot checks should accompany the surface as it grows.
Passing an automated checker alone is not sufficient evidence.

## State And Rendering Direction

React owns presentation composition and lifecycle, not engine state. Rust
application views terminate at a typed client-side store. Components consume
stable application view values rather than engine objects, Tauri globals,
WebSocket frames, or log text.

Large torrent, peer, file, tracker, piece, and log collections use lazy or
virtualized rendering. Only visible rows plus bounded overscan should own DOM
nodes. Stable row identity, narrow subscriptions, and collection revisions
should prevent unrelated application changes from rerendering every logical
row. Sorting, filtering, formatting, and selection must remain measurable and
bounded for thousands of torrents and much larger file collections.

Browser application-view delivery uses bounded periodic JSON snapshots and
keyed diffs through one leased view set; Tauri now streams the same batches.
The UI architecture does not depend on full-state replacement or broad React
context updates. A later frame-coalescing policy may paint latest-state stream
changes on animation frames without changing view semantics. Binary encoding
is a separable measured codec optimization, not automatically a new
application API.

Ordered events, diagnostics, command results, and errors must not silently use
latest-value conflation intended for current state. The exact delivery and
recovery rules live in
[`application-view-api.md`](application-view-api.md).

## Zustand Store And Controller

Create one Zustand vanilla store per web application instance and provide it
to React through context plus typed `useStore` selectors. Do not use a module
global hook as the application authority. Per-instance construction supports
isolated tests, more than one client in a process, and explicit installation of
the transport and platform adapters.

The store is a materialized local copy of the named Rust views currently of
interest, not a complete engine mirror. Keep projection state keyed by the
client's stable `view_id`; normalize large collection views into ordered IDs
and rows keyed by stable identity. Do not force partial torrent-list,
torrent-detail, peer, and other projections into one universal entity whose
field presence becomes ambiguous.

`InspectionApplication` exposes semantic desired views rather than generated
Rust `ViewSpec` values. The live adapter maps them to one leased Rust view set;
the demo adapter obeys the same request and eviction behavior. Responsive
navigation determines the set: a phone library retains the torrent list, a
phone detail retains the selected summary and active detail only, and a wide
split may retain list, summary, and peers together. The torrent list is not a
mandatory global replica.

Each materialized view distinguishes not requested, loading, ready,
unavailable, unsupported, and stale. Within ready values, `null` means a
supported field currently has no value; missing required fields are validation
or programming failures. Transport recovery may retain prior values visibly
as stale, but a fresh view-set snapshot atomically replaces them before new
patches apply.

Keep the layers explicit:

```text
ApplicationClient
        |
ViewController
  view-set ID, cursor, polling/stream task, retry and cancellation
        |
validated UpdateBatch
        |
pure applyUpdateBatch reducer
        |
Zustand vanilla store
        |
React selectors and virtualized components
```

Sockets, Tauri Channels, promises, polling loops, abort controllers, and task
handles do not live in Zustand. One `ViewController` owns those lifecycles and
applies each valid update batch as one atomic store operation. Snapshot and
patch reduction remains pure TypeScript so it can be tested without React or
Zustand and reused by a headless CLI.

Reducers preserve references for unchanged view containers and rows. A
virtualized table selects ordered row IDs while each visible row selects its
own value, preventing an unrelated row update from rerendering every visible
row. Compound selectors use shallow equality only where needed; broad whole-
store subscriptions are not the default.

Do not persist the materialized engine replica. A reload recovers from fresh
Rust snapshots. Persist only explicit presentation preferences such as theme,
density, columns, and layout. Avoid Immer initially so patch behavior and
structural sharing remain visible. Development tooling may expose one named
action per update batch, but high-frequency row changes must not flood a
production store or an unbounded devtools history.

Zustand and immutable keyed containers are the initial simplicity choice, not
a performance claim. Synthetic scale tests measure cloning, reduction,
selector notification, rendering, and memory before introducing entity
sharding, mutable versioned containers, or another store abstraction.

## State Ownership

Browser-local presentation preferences may include sidebar visibility and
width, density, theme, column configuration, inspector size, dock or focus
preference, last selected tab, and preserved navigation context.

Tactical `047` establishes the first global presentation preference. The
user-facing vocabulary is **Interface size** with Compact, Standard, and
Spacious presets; Standard is the fresh-install and invalid-storage fallback.
The versioned value is owned by the per-application Zustand store and persisted
best-effort in browser-local storage. Semantic CSS variables change type,
controls, icons, tabs, menus, dialogs, and spacing without whole-document zoom.
The same typed preset definition supplies virtual-table header and row CSS plus
absolute-row and keyboard-scroll arithmetic. Compact preserves useful desktop
density but not illegibly small icons, while coarse-pointer controls retain
44-pixel targets.

Tactical `050` extends that same versioned appearance owner instead of adding a
competing setting. Version 2 persists Interface size with **Color theme** as
Auto, Light, or Dark; at landing, version-1 sizes migrated intact with Auto.
Auto follows live `prefers-color-scheme` changes in CSS, while explicit choices
override the system. The validated root attribute is installed before the inspection
bundle's dynamic React import and synchronized from presentation state after
live changes. The since-retired direct-DOM UI retained its Dark-only browser
declaration and did not interpret the React appearance record while both entry
paths still existed.

Tactical `099` extends that browser-local appearance owner with **Data
units**. Decimal powers of 1000 with `kB`, `MB`, and `GB` are the fresh and
then-migration default; explicit Binary preserves powers of 1024 with `KiB`,
`MiB`, and `GiB`. Version 3 persists all three fields together. Tactical
[`179`](../tactical/179-disposable-incubation-state-epoch.md) makes version 3
the only accepted record: versions 1 and 2 now return current Standard, Auto,
and Decimal defaults rather than preserving old fields. The choice now covers every
generic shared React byte and rate display, including exact integer-string
counters and Speed chart labels. Raw application values, sorting,
calculations, chart geometry, and literal IEC text describing exact engine or
protocol geometry remain unchanged.

Tactical `055` adds a separate versioned navigation preference for the active
Library, Transfers, or Workbench destination and each destination's local
filter. Transfers is the fresh and invalid-storage fallback. The preference
contains presentation values only and tolerates absent, malformed, future, or
denied storage. Tactical `058` keeps the current torrent and explicit batch
selection as separate ephemeral application-store concepts. Missing torrents
are pruned without inventing a replacement after the user clears or loses the
current row, and neither concept is persisted.

Archive state, user labels, and other organization intended to survive a new
webview or appear in another client are durable application data. Torrent
activity, queue state, storage, and content retention remain separate engine
or application concepts. The API design must make those distinctions explicit
before controls are implemented.

Download roots, the default root, and the choice attached to a torrent are
also durable application state rather than browser-local preferences. The
shared React surface requests a platform-owned picker capability and selects
established root identities; it never persists an ambient path or browser
directory handle. The accepted root, start-content, and metadata-backed file
selection flow lives in [`download-roots.md`](download-roots.md).
Metadata-only intake uses durable paused application intent. Completed
Tactical
[`203`](../tactical/203-jstorrent-shaped-add-time-file-selection.md) adds the
other deliberate selection surface: a default-on add stage backed by durable
application pending state. It uses checked Normal/unchecked Skip, logical
All/None, a compact range draft, and at most three cached 1,024-row pages.
High and every post-add priority change remain in the Files tab.

Completed Tactical
[`204`](../tactical/204-cross-product-localization-foundation.md) makes
presentation copy an explicit owner across shared React/Tauri, Android, and
iOS. React uses one packaged ICU message provider and browser locale
negotiation; Android and iOS use platform-native catalogs and system locale
selection. English is the only production locale. Generated long-LTR and RTL
pseudo locales are confined to extraction, layout, and accessibility gates.
Locale remains presentation state and does not enter the Rust application
contract.

## Validation Direction

Routine validation uses the authenticated headless browser host and does not
launch or focus the Tauri application. Each meaningful presentation slice
should retain screenshots at representative wide, compact, and phone-sized
viewports and exercise pointer, keyboard, and touch-oriented paths where
applicable.

Tactical `034` establishes the first concrete evidence: deterministic wide,
compact, and phone screenshots, keyboard and pointer browser paths, serious
and critical axe checks, and bounded rendering of 2,000 torrents plus 10,000
peers. The sampled large scenario retained 840 total DOM elements, used about
29.3 MiB of JavaScript heap, rendered initially in 247 ms, applied a simulated
ten-second update in 50 ms, and recorded no browser long tasks. These numbers
are development smoke evidence rather than general performance guarantees.

Synthetic scale fixtures should cover thousands of torrents, peers, and files
without public network traffic. Record visible-row count, update and render
latency, long-task or missed-frame evidence, and memory high-water when a slice
changes table or store behavior. Real torrents remain useful spot checks after
deterministic presentation evidence passes.

Tactical `035` adds the first live-product evidence through the same
components. A production Vite build in headless Chrome observed a loopback
libtorrent peer from active work through verified completion and keyed row
removal at wide, compact, and phone viewports. It also held browser update
operations beyond a shortened server lease: the header exposed reconnecting,
the peer row remained visibly stale, and a fresh view-set snapshot restored
connected state. Serious and critical axe findings were empty. The demo scale
measurements above remain the larger rendering-pressure evidence; one live
peer is interoperability evidence, not a scale profile.

Tactical `203` adds wide/narrow, keyboard, focus, paging, restart, and Axe
coverage for the staged add dialog. Its controlled 122-file product run kept
at most three pages, selected one boundary file, created no pre-confirm
payload, and later exercised Files **Download** on an initially skipped file.
The final live run reported zero serious or critical Axe findings.

Tactical `040` preserves the same independent frontend path for lifecycle
controls. The demo adapter deterministically archives and removes rows; the
live adapter maps those intents to generated Rust commands. Removal restores
focus after Escape or completion, retains the dialog and error after command
failure, and displays an irreversible warning only when managed-data deletion
is selected.

Tactical `041` makes Files a live responsive detail rather than a placeholder.
The default table shows Name, Folder, High/Normal/Skip selection, Size, Progress,
Done, and Verified; Type, Index, torrent offset, piece span, and absolute
Storage Path are optional columns. Padding remains available in the typed
projection but is hidden with an explicit count. Exact decimal counters use
`BigInt` comparison, null sorts last in both directions, zero remains visible,
and semantic enum order is explicit. Live update sorting is opt-in so changing
rates or progress do not make rows jump while being inspected.

Tactical `058` adds a Files-local current row and explicit multi-selection
using the shared table interaction. Tactical `063` activates its More menu
for the current row or selected range; completed Tactical
[`176`](../tactical/176-durable-high-file-priority.md) makes those shared
actions exactly `High`, `Normal`, and `Skip`. The
live adapter sends bounded semantic file indices, displays command results,
and waits for the authoritative Files view to change the priority column. Demo
scenarios retain disabled actions with an explicit reason rather than
pretending to mutate engine state.

Tactical `077` replaces the component-local Files and torrent action menus,
table Columns popover, and column-help overlay with one locally styled React
Aria Components layer. It retains action and table state in the feature
owners, while the shared layer owns body-portalled rendering, collision-aware
placement and sizing, focus, dismissal, nested-menu behavior, and portal-safe
theme/interface metrics. Tactical `085` now uses that context-trigger
capability on production actionable rows, through one named trigger outside
the ARIA grid. Table touch long press still selects, and read-only tables retain
ordinary browser context behavior.

The Add dialog now has one checked-by-default **Start downloading files when
metadata is available** checkbox. Clearing it acquires metadata without
creating content artifacts; no file tree or second modal is introduced. The
dialog carries only its title, the folder list with **Choose another
folder…**, that checkbox, **Always use this folder**, and the request source
for an external add, without explanatory paragraphs. **Always use this
folder** makes the chosen folder the default before hiding add options.
**Add all sample torrents** shows this same dialog once and applies its
choices to the whole batch.

The web file-selection dialog matches Android's Tactical
[308](../tactical/308-android-optional-add-selection.md) consent: before
magnet metadata arrives its **Download** button sends
`download_all_pending_add`, honoring **Don’t show file selection again**;
afterwards the same button confirms the checklist. Dialog buttons keep one
label while busy and are disabled with `aria-busy`, so a click target never
changes width or text under the pointer.

Hiding add options continues to use the usable
default root and starts content normally. Tactical `083` reuses this exact
dialog for a chosen `.torrent`. Empty or over-64-MiB files fail locally; a
read or adapter failure remains visible, and a dialog-owned file can be
retried without selecting it again. Chooser cancellation is a no-op, and the
hidden input resets after selection so the same file can be chosen later.

Column visibility, widths, sort, and live-sort preference persist per table in
a versioned browser-local setting. Resize separators work by pointer and
keyboard. Wide, compact, and phone evidence keeps the active tab visible,
closes the phone drawer fully, and leaves horizontal scrolling available for
configured columns. Tactical `173` removes the former viewport-threshold
filter that contradicted this contract: a checked column now renders at every
width, while unchecked optional columns remain absent. Two-axis touch panning,
contained horizontal overscroll, and directional edge fades make the complete
configured set reachable without compressing columns or expanding the virtual
row window. Serious and critical axe findings are empty.

Tactical `047` adds wide Compact, Standard, and Spacious geometry assertions,
reload persistence, desktop and phone Settings-sheet focus containment, and
serious/critical axe checks. Standard uses 36-pixel controls and table rows,
Compact retains 30-pixel desktop controls and 32-pixel rows, and Spacious uses
44-pixel controls and 42-pixel rows. The existing 2,001-torrent and
10,001-peer scenario remains bounded at 824 DOM elements after the new default;
this is sampled development evidence rather than a browser-wide ceiling.

Tactical `050` adds browser assertions for Auto under both system schemes and
through a live media change, explicit Light under system Dark, explicit Dark
under system Light, complete size/theme reload persistence, and the persisted
attribute already present at first React content. Explicit Light and Dark
Settings/application scans have no serious or critical axe findings. The new
dark scan also moved the demo strip and primary action from hard-coded light
colors to palette-specific semantic tokens after exposing contrast failures.

Tactical `099` adds exact Decimal/Binary threshold and arbitrary-precision
formatter tests, its then-current version-1/version-2 migration and denied-
storage coverage, and complete-record component persistence. Tactical `179`
replaces the migration cases with exact old-version default-reset coverage.
Its 20-scenario headless browser
run exercises live switching across Library, Transfers, General, Files, Disk,
DHT, and Speed; retains raw row order and canvas geometry; covers desktop and
phone Settings; preserves technical IEC copy; and reports no serious or
critical axe findings. The run also corrected an existing removal-dialog
light-theme contrast failure by using the established strong danger text
token.

Tactical `104` adds the same default-visible 84-pixel ETA to Transfers after
Rate and retains Workbench's existing ETA column. The live adapter preserves
exact decimal strings, the formatter uses `BigInt`, only estimates participate
in decimal sorting, and typed unavailable/warming/stalled states remain
distinct accessible `—`/`∞` values. The production-preview browser case
covers all four states, Compact mode, titles, accessible names, and no serious
or critical axe findings. Tactical `173` supersedes its phone-only removal:
ETA remains configured and rendered in the horizontally scrollable table at
narrow widths. Vitest passes 214 tests with the two existing opt-in skips.

Tactical `106` adds pure Decimal/Binary, idle, disconnect, active-download,
upload-only, and unavailable-direction title coverage. React proves mounted
demo state and unmount restoration; the live adapter proves the independent
two-metric one-second view and both mapped rates. TypeScript, all 219 Vitest
tests initially passed. The explicit leading/trailing throttle adds fake-clock
coverage at 999 and 1,000 milliseconds; all 221 Vitest tests, the production
build/CSP scan, and the focused headless destination case pass.

Tactical `055` adds deterministic navigation, storage-denial, selection
repair, destination-local filter, view-leasing, command, and component tests.
The headless browser suite covers wide and phone destination navigation,
contextual drawers, Library-to-Workbench handoff, shared selection, keyboard
operation, and empty serious/critical axe findings. Its 2,000-torrent scenario
keeps Workbench and Transfers below 100 rendered rows, keeps Library below 100
rendered cards, and retains fewer than 2,000 total DOM elements after changing
destinations. These are bounded development assertions rather than a general
browser performance guarantee.

Tactical `072` adds pure comparator, reducer, lease, navigation, component,
and headless browser coverage for the Library detail. Its permanent six-video
TV scenario proves numeric ordering, sidecar exclusion, exact Downloaded/
partial/skipped labels, Media/All files switching, wide and 390-by-844
layouts, focus restoration, no horizontal overflow, and no serious/critical
Axe findings. In the 4,096-file scenario, 3,003 recognized videos mount only
19 list rows and retain 421 total DOM elements; Chromium reported 53,192,260
used heap bytes on the development host. The production browser proof observes
metadata pending through six-media/eight-file catalog arrival and completion,
view eviction/recovery, zero semantic HTTP calls, and joined cleanup against a
controlled pinned-libtorrent peer.

Completed Tactical
[`189`](../tactical/189-library-playback-and-torrent-size.md) turns each Media
play glyph into an accessible button whose enabled state comes from the typed
availability row. An eligible activation dispatches the existing exact-file
`open_file` action; browser popup reservation and capability navigation remain
inside the live adapter. The same repair removes the adapter's hard-coded null
torrent size and proves one authoritative 4.4 GB value across Library cards,
Library detail, Transfers, and Workbench General. Focused React/live/reducer
tests pass, as do the wide/phone Library browser case and accessibility scan.
The complete Playwright run retains one separate Swarm horizontal-scroll
indicator failure that passes in isolation; this slice makes no claim that the
unrelated full suite is green.

Tactical `083` adds deterministic empty/nonempty Add, pointer/keyboard chooser,
cancel, advisory accept, same-file reset, default/chosen root, start-content,
post-success preference, busy, size, read-failure, retry, and byte-intent
coverage. Its production headless run observes the actual file chooser and
one binary frame through the ordinary WebSocket, no semantic HTTP requests,
the visible imported row, no payload artifacts for metadata-only intake, and
no serious/critical axe findings.

Tactical `058` adds pure state and component coverage for independent current
and batch torrent selection, modifier and keyboard entry, touch long press and
movement cancellation, empty-space clearing, shared Transfers/Workbench mode,
and Files-local selection. Browser evidence covers the explicit desktop path,
a phone-sized long press, disabled Files actions, wide/compact/phone Files
layouts, and empty serious/critical axe findings. The 4,096-row scenario still
renders fewer than 100 table rows; one sampled run retained 665 DOM elements,
52,586,655 bytes of JavaScript heap, and a 41 ms scenario update.

Tactical `059` adds component evidence for permanently stable selection-column
geometry, inactive checkbox entry, forward and reverse Shift ranges, range
shrinking, checkbox Shift-click, sorted-order resolution, and mode exit. The
application and browser suites exercise the same range behavior in Transfers,
Workbench continuity, and the 4,096-row Files surface while retaining bounded
virtual rendering and empty serious/critical axe findings.

The deterministic 4,096-row scenario hides one padding row and rendered 690
DOM elements with 66,468,705 bytes of sampled JavaScript heap. A complete
ten-second scenario update and paint took 55 ms. Its hash-failure timeline
regresses only unverified Done bytes while Verified remains monotonic, then
recovers. These are bounded development observations, not browser-wide
performance guarantees.

Tactical `042` removes the live adapter's permanent hash-only label. Completed
Tactical
[`172`](../tactical/172-provisional-magnet-display-name.md) refines the
pre-metadata state: a valid bounded magnet `dn` labels Library, Transfers, and
Workbench immediately, while `Torrent <hash-prefix>` remains the fallback
when it is absent. After verified metainfo is durably recorded, the shared
torrent row automatically uses its bounded verified name. No view selection,
table identity, or local preference changes during that transition, and the
source URI itself never enters React state.

The detail-tab regression suite records each tab's layout offset and width
while selecting every view. It asserts label-only tabs, equal footprints at
every interface size, the divider before Disk, and horizontal overflow at
phone width. Narrow layouts may scroll to reveal a clipped active tab, but the
tab boxes themselves do not reflow.

Tactical `087` removes the redundant configured-tracker and connected-peer
badges and establishes 88-, 100-, and 112-pixel tab footprints for Compact,
Standard, and Spacious. Headless Chrome confirms equal, stable geometry at
wide, compact-window, and phone widths, including the real phone
list-to-detail path and horizontal overflow. The representative 1,440- and
390-pixel strips were visually inspected with the torrent/session divider
intact and no label clipping or wrapping.

Tactical `049` replaces the generic Logs table with a dedicated ordered
console. Opening Logs does not require a selected torrent. Capture profile,
category prefixes, and pinned torrent scope alter the desired diagnostics
view; text, severity, category, and torrent display filters operate over the
already retained local history. Expanded entries show deliberately typed
context and provide copy actions. Local clear advances a sequence watermark,
and scrolling away from the bottom exposes a new-record action without
stopping bounded ingestion.

The permanent 10,000-record scenario retains 2,048 semantic records and
renders only 24 record elements in the sampled wide viewport. Wide and phone
screens pass serious/critical accessibility checks, retain keyboard-operable
controls, and do not make the continuously changing feed an `aria-live`
stream. Console state remains one application-lifetime presentation concern;
no diagnostic history or filters are written to browser storage.

Tactical `071` adds deterministic component and browser coverage for the
selection-aware copy action. The browser grants clipboard permission, reads
back the exact canonical URI, checks restored More focus and disabled
multi-selection behavior, and finds no serious or critical Axe violations in
the open menu. Tactical `085` supersedes only the prior multi-selection
disablement: it reads back one exact newline-delimited value for every selected
torrent in stable order. No submitted-source URI or durable clipboard state is
added.

Tactical `077` adds deterministic overlay evidence at 320x568, 390x844,
456x1024, 920x720, and 1440x900, at every trigger corner and after live
resize. Pointer, touch, keyboard, nested, context, dismissal, lifecycle, all
density/theme combinations, and open-overlay serious/critical Axe checks pass.
The full browser gate passes 28 deterministic cases with five live opt-in
cases skipped. Open File actions, Columns, help, and shared menu/submenu
screenshots were visually inspected at representative wide and phone sizes in
Light and Dark. The accepted dependency adds 153.44 kB minified / 48.21 kB
gzip to the production bootstrap while removing about 0.43 kB of component
CSS; `npm audit --omit=dev` reports no vulnerabilities and the CSP scan stays
clean.

Tactical `085` adds pure action-policy and component coverage for exact action
order/grouping/placement, whole-selection availability, sequential command
continuation, bounded failure feedback, plural removal retry, and shared file
priority rendering. The complete deterministic browser gate passes 29 cases
with seven live opt-in cases skipped; it covers Transfers, Workbench, Files,
pointer and keyboard context entry, plural clipboard readback, collision,
focus return, 4,096-file virtualization, and empty serious/critical Axe
findings. Two focused cases pass again against the production Vite preview,
and the build/CSP scan remains clean.

## Likely Sequencing

1. The accepted view-set contract, generated TypeScript/schema, polling
   client, and pure reducer described in
   [`application-view-api.md`](application-view-api.md) are implemented and
   headlessly validated by Tactical `033`.
2. The React/CSS Modules shell, adaptive navigation, Zustand/virtual-table
   foundation, deterministic named demo adapter, and accessibility baseline
   are complete in Tactical `034`.
3. Tactical `035` defines stable Rust torrent and active-peer inspection
   projections, self-expiring leases, semantic view selection, suspension
   recovery, and the live frontend adapter. This step is complete.
4. Files is complete in Tactical `041`, the schedule-backed Trackers view is
   complete in Tactical `043`, and the structured ordered Logs console is
   complete in Tactical `049`.
5. Connect remaining detail views according to debugging and product value,
   keeping unsupported scaffolds truthful.
6. Tauri streaming is complete in Tactical `048`. Accepted Tactical `060`
   owns the bounded multiplexed browser WebSocket and diagnostic HTTP
   comparison. Measure browser update volume and decode/reduce/render cost
   before adding binary encoding or more specialized rendering paths.

This is continuing direction, not an active tactical or permission to build
all stages as one slice.

## Deliberately Open Decisions

- the default wide-screen detail position and user-selectable layout modes;
- inbox, category, label, and queue semantics; archive and removal retention
  semantics are implemented by Tactical `040`;
- whether later navigation complexity justifies a router or icon dependency;
- exact columns, row-detail interactions, and further table customization
  outside the non-sortable Logs console;
- the first supported browser and phone access posture beyond headless and
  local desktop use; and
- the thresholds that would justify a binary codec.

Tactical `033` completed the headless transport-independent view-set
foundation. Tactical `034` completed the first visible React and demo-scenario
foundation. Tactical `035` completed the live torrent/peer adapter, exact
active-row membership, local endpoint posture, semantic view selection, and
suspension recovery. The implemented view-set limits and remaining delivery
choices are recorded in
[`application-view-api.md`](application-view-api.md).


## Public desktop cutover presentation, 2026-10-10

Shipment295 activates exact public desktop0.3.0 downloads on the main website
with phone/wide Windows, both Mac, both Linux and source-link captures. The
project website and update guide now describe actual desktop availability
while Android/extension store arrivals remain separate. Astro checks/build
and phone/wide geometry pass; the original box and navy/blue design remain.

Final Mac ARM capture079 retains narrow Storage Unavailable truncation and
a horizontally scrolled details tab row as design follow-ups. Actual signed
Android28 store capture084 retains a tight priority-button/file-name gap in
the Files row. Current listing images use library/intake/details instead;
these notes do not imply new package bytes or hidden runtime failures.

## Known torrent-list scroll regression, 2026-10-11

The maintainer reports that the updated desktop app returns a scrolled torrent
list to the top about once a second. Source `c9d335f0` reproduces the behavior
with the production shared React bundle, a real loopback-only gateway, a fresh
temporary profile containing 120 independently generated stopped torrents, and
bundled headless Playwright Chromium at 1280 by 800. With the first sorted row
selected, mouse-wheel scrolling reaches `scrollTop = 1800`, then an application
refresh sets it to zero. Repeating the scroll repeats the reset. Selecting a
different row pulls the viewport back to that row instead. Clearing selection
preserves the same 1800-pixel scroll across multiple one-second view batches.

The existing 2,000-row `large-swarm` demo independently reproduces the reset
with its clock running; `?demo=large-swarm&at=0&autoplay=0` preserves the scroll.
`VirtualTable`'s current-row visibility effect depends on `sortedRows` and
`getRowId`, so ordinary refreshes re-run its imperative `scrollTop` assignment
even when the current row has not changed. This is a shared web presentation
regression; the investigation does not qualify native Android/Compose behavior
or the exact installed desktop package.

Validation ran `cargo build --locked -p rstorrent-gateway --bin
rstorrent-gateway`, the same-origin production `npm run build --prefix
clients/web` including its CSP check, and a temporary Node/Playwright runner
using real mouse-wheel input, 50-ms scroll samples, observed WebSocket batches,
and instrumentation of programmatic scroll writes. Both corrected runner
passes reproduced the reset. All gateway processes joined with exit
zero, browsers closed, and temporary profiles, fixtures, runner and logs were
removed. The installed profile and primary browser were not used.

Completed Tactical [298](../tactical/298-torrent-list-refresh-scroll.md) fixes
the shared component by revealing each current selection once when its row is
available. Ordinary refreshes and reordering preserve manual scroll; cleared or
changed selection and existing keyboard navigation still reveal the intended
row. The new component and running-clock browser regressions fail before the
fix and pass afterward. Web typecheck, 483 unit cases (two existing skips),
all 31 inspection browser cases, and the production/CSP build pass. A fresh
120-torrent gateway check preserves exact first/middle/reselected scroll
positions across continued one-second view batches with zero programmatic
writes. Installed-package delivery remains separate from this local fix.

## Canonical repository links

Tactical [305](../tactical/305-canonical-jstorrent-repository.md) retargets
shared support/download navigation and the matching exact Tauri opener scopes
to `kzahel/jstorrent`. Browser behavior and native opener ownership are retained.
Headless release hints accept only the exact current/former Rust repository
URLs for the same version, allowing already-installed hosts during cutover.
