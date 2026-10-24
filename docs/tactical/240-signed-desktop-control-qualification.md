# Tactical 240: Signed Desktop Control Qualification

Status: **Complete, 2026-09-30.** Bounded signed checkpoint; campaign 231
continues. Follows 232–239.
Topics: `beta-release-readiness`, `desktop-jstorrent-replacement`,
`client-surfaces`, `capability-readiness`.

## Outcome And Scope

Publish one current-source signed Latest prerelease through the existing CI
workflow, then qualify its installed desktop-control path in claimed macOS
arm64, Windows x86_64 and Linux x86_64 guests. The user explicitly requested
this release and installed verification. Keep Stable, production identities,
updater keys and routes unchanged. No legacy importer or personal migration.

First correct stale CI harness expectations exposed by the current source:
the package hello includes `desktop_control_v1`, and pending-add cancellation
removes the torrent before Android's diagnostic snapshot is projected. A
removed row cannot be required to retain its ID in that projection. Preserve
the strict capability list, cancellation marker, joined removal and independent
no-payload assertions. No engine or Android product behavior changes are
planned.

## Contracts, Dependencies And Limits

Read the release runbook, 230/232/234/237/238/239 and owning topics. Use the
existing verified-main selector and five-target signing/notarization pipeline;
record its exact selected source, run, version and published artifact hashes.
Successful older-source CI cannot qualify current-source delivery. Builder
checks precede installed checks. macOS initial installation uses the DMG;
updating uses the signed `.app.tar.gz`. The native messaging host is bundled,
then registered/copied per user by the installed application. Verify both
bundled and registered helper trust, not only the outer installer.

Use Machine Control discovery, read-only doctor, exclusive claims and supported
readiness. Preserve inherited apps, profiles, registrations and power state.
Use separately identified test browsers and a fresh native-selected library.
Retain 232/234's one-runtime, explicit-intent, attach-only reconnect, picker
ownership/cancellation and joined-Quit contracts. Use the existing bounded
32-MiB controlled fixture and independent hash oracle, never a public swarm.
Own and terminate browsers, fixtures and helper processes; remove task artifacts
and release claims. No new persistent task or resource owner is introduced.

## Validation And Stopping Condition

1. Correct the stale harnesses, run relevant local checks, commit and push
   normally, and require exact-source main CI success.
2. Dispatch the existing Latest workflow; verify all five signed package jobs,
   collector, immutable assets and the selected source. Record failures without
   bypassing source, signature or package checks.
3. Install the exact published candidates in guests. Verify platform trust,
   first-run registration and bounded repair, cold background extension launch,
   repeated/warm attach, native launch, singleton requests, shared library,
   valid/invalid/stale credentials, pause/resume, exact controlled bytes,
   picker success/cancel/disconnect/Quit, passive no-resurrection and explicit
   relaunch. Exercise the existing signed update path with a controlled older
   cohort and record catalog compatibility separately from external bytes.
4. Record exact commands/evidence and clean inherited state. Update the campaign,
   living topics and release runbook; commit bounded completed slices.

Stop when that bounded signed installed matrix passes or an evidenced external
blocker prevents further progress. Native sleep/wake, interrupted replacement,
broader browser endurance, production graduation and importer work remain
separate gaps; this checkpoint makes none of those claims.

## Initial CI Findings

Prior main CI `36609998712` fails the exact package hello assertion on all four
desktop checks: actual capabilities are `launch_desktop, desktop_control_v1`.
Its Android SAF scenario records `pending_add_cancelled` followed by
`torrent_removal_completed` with `torrent=none`; the removed local row is no
longer projectable. The scenario clears logcat after the preceding fixture's
joined cleanup, admits one pending local fixture and independently checks its
payload namespace. Requiring the cancelled row's ID in the final diagnostic
snapshot is the stale predicate. These are harness failures, not yet evidence
of an installed signed product failure.

The later `0aa7a56e` CI run's Android job passes without this fix, confirming
the observation depends on projection timing; the package predicate remains
strictly stale. Local validation for the bounded harness correction:

```sh
source ~/.profile
cargo build -p rstorrent-native-host
node scripts/smoke-native-host.mjs target/debug/rstorrent-native-host
python3 -m unittest discover -s scripts -p test_android_runtime_smoke.py
python3 -m py_compile clients/android/run_bootstrap.py
node --test scripts/*release*.test.mjs scripts/*desktop*test.mjs
python3 -m unittest discover -s scripts -p test_distribution_review.py
git diff --check
```

All pass: exact native hello, five Android runner controls, 25 release/package
tests and 18 distribution-review tests. Installed Android cancellation remains
the owned API-35 CI gate; these local checks do not claim that runtime evidence.
Official [Tauri signing](https://v2.tauri.app/distribute/sign/macos/),
[Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
and [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
guidance was reviewed for the existing signing and registered-helper contract.

The release workflow now also requires valid expected-publisher Authenticode
signatures on both installed Windows executables, including the native host.
Installer signatures alone do not establish this. macOS already performs deep
strict bundle verification; guest checks additionally inspect the copied host.

## Installed Matrix Preparation (Not Current-Source Qualification)

The source fixes are `2f246efd`; installed Windows signature enforcement is
`99bbe08d`. Normal pushes start exact-source CI `36620048563`. The superseded
`0aa7a56e` run required force-cancellation after ordinary cancellation left its
iOS job stuck in `Complete job`; no failed gate was waived. The corrected
Android owned runtime, web, extension, workflow and iOS jobs pass; remaining
jobs are still running at this checkpoint. No new release has been dispatched.

Common Machine Control doctor/claim/ensure-ready prepares the Apple-hosted
macOS 26.6.2 arm64 guest (inherited suspended), Windows 11 build 26200 x86_64
guest (off), and recreated Ubuntu 24.04.5 x86_64 guest (off, glibc 2.39).
Windows has an inherited installation/profile: move aside three paths, record
315 file hashes and seven affected registry key export/absence receipts before
installing. No source overlay is needed. macOS LaunchServices and Linux MIME
state are preserved. Cleanup and claim release are still pending.

Stage signed 0.2.501 as the controlled update baseline, never as current-control
evidence. Published/downloaded hashes:

| Artifact | SHA-256 |
| --- | --- |
| macOS arm64 DMG | `dd4beece26907d22c23aeab96798cd31f0c0a5264e7ba9dc36297ff5aaa39970` |
| Windows x64 NSIS | `17c43294a3ea6a100c743e8761ffb8a0021c2d153acc24c93c85963c08f5f9e9` |
| Linux x64 AppImage | `b6ce090248313e9752b7e505a976c6d58bc6496f63c92d6dc1102f173942670f` |

Builder inspection proves macOS arm64/minimum 13.0 and Linux x86_64/maximum
required GLIBC 2.34 before guest transfer. macOS deep strict verification and
Gatekeeper report Notarized Developer ID. Windows installer and both installed
executables have valid Kyle Graehl Authenticode signatures. The macOS registered
host preserves its bundled bytes, SHA-256
`61eee779dd26215c047d01f20efd9ebc7703cce896af68e2c7862a66b7e192fe`,
Developer ID team `VD7BYQ6ABM` and hardened-runtime flag. A standalone host
`spctl --assess --type execute` reports valid code that does not seem to be an
app; do not equate that app-oriented assessment with broken code signing or
claim standalone Gatekeeper acceptance. Browser execution is a separate gate.

Native Downloads/Add folder selects fresh `root-one` on each guest; native
About/updates selects Latest. External sentinel SHA-256 is
`f869fbf0f9f7176e8baa3b1a2bf4657367aaeddc8d586724a5be609d45d2e5c0`.
Both baseline and current source use catalog schema 26. Chrome for Testing
151.0.7922.34 is separately installed under task-only roots with CDP 9222 and
the packaged beta extension; no normal host browser runs. The beta extension
ZIP hash is `a21fb6e52ee720a83987d0b5094a60e1a338014c024cdaa977cbcadd47538533`.

The Windows skill's low-level login example incorrectly treated inventory ID
`winvm` as an SSH destination on the Linux controller. That failed before
credential delivery. Common claimed `testbed -- login` resolves the actual
transport and stored credential and confirms the Default desktop. Machine
Control commit `71a0865` corrects the guide; it is committed locally, not pushed.

## macOS Standard Browser Registration Correction

Before publication, source review finds the macOS Chrome for Testing support
root misspelled as `Google/ChromeForTesting`. Official Chromium
[`chrome_paths_mac.mm` at 151.0.7922.34](https://raw.githubusercontent.com/chromium/chromium/151.0.7922.34/chrome/common/chrome_paths_mac.mm)
uses `Google/Chrome for Testing` when no `CrProductDirName` override exists;
the exact installed 151.0.7922.34 bundle has no override. Linux's documented
`google-chrome-for-testing` root already matches. Correct the macOS root and
exercise initial manifest creation and deletion repair in the real spaced
directory, without creating an absent ordinary Chrome root.

The 232/237 default test-root repair evidence used the misspelled directory;
its custom-profile browser tests remain valid, but that evidence did not prove
actual default-profile discovery. This checkpoint replaces that registration
claim with an installed run using the test browser's standard support root.
Re-run exact-source CI after this correction before dispatching the release.

Local correction gates pass: `cargo fmt --all -- --check`,
`cargo test -p rstorrent-desktop --lib` (54 tests),
`cargo clippy -p rstorrent-desktop --all-targets -- -D warnings` and
`git diff --check`. This is a desktop registration adapter change; no shared
application boundary or Android behavior changes.

## Newly Reported Web Test Dependency Advisories

The next normal push reports six new open Undici alerts, including a high
TLS-validation finding. `npm ls undici --prefix clients/web` identifies the
locked `jsdom@29.1.1 -> undici@7.29.0` test dependency. Review upstream
[7.29.1 security fixes](https://github.com/nodejs/undici/releases/tag/v7.29.1)
and [7.30.0 changes](https://github.com/nodejs/undici/releases/tag/v7.30.0),
then update only that compatible transitive lock entry. Keep the existing
three-lockfile release audit fail-closed, including the independently reviewed
GLib backport; do not dismiss alerts or merge unrelated Dependabot changes.
Web type, unit and production/CSP build checks and fresh audit review precede
the next exact-source CI. This does not add a shipped Node runtime dependency.

`npm update undici --prefix clients/web --ignore-scripts` changes only the
Undici lock entry to 7.30.0 (version, URL and integrity); direct dependencies
remain unchanged. `npm run typecheck --prefix clients/web`,
`npm test --prefix clients/web` and `npm run build --prefix clients/web` all
pass, including the production CSP check. Fresh Cargo, web npm and website npm
collection followed by `scripts/review-dependency-audit.py
--require-release-ready` reports `release_ready=True`. The separately exposed
GitHub GLib version alert remains visible; its exact source backport review is
unchanged. No audit exception was added.

## Exact-Source CI And Release Dispatch

Main CI [`36623804397`](https://github.com/kzahel/rstorrent/actions/runs/36623804397)
passes all ten required jobs at
`ef5e2f31279b899aa8cee9b48e6ce5b85f67fd67`: Rust/workspace/controlled interop,
web browser tests, extension packaging, workflow tools, Android owned storage
lifecycle, iOS simulator/archive, and all four desktop package checks. The two
manual-only jobs are skipped by design. Windows installer compilation is the
last gate; no gate is bypassed or accepted from an older source.

```sh
gh run view 36623804397 --json status,conclusion,headSha,jobs
gh workflow run nightly-desktop.yml --ref main -f force=true
gh api repos/kzahel/rstorrent/actions/jobs/109617116848/logs
npm run package --prefix clients/extension
shasum -a 256 target/extension/jstorrent-beta-0.4.0.zip
```

Forced Nightly run
[`36630173322`](https://github.com/kzahel/rstorrent/actions/runs/36630173322),
dispatched 2026-09-29 at 20:59:06 UTC, selects that exact source and
`desktop-latest-v0.2.701`. The independently rebuilt beta extension remains
byte-identical to the staged ZIP above. Signing, publication and installed
qualification are still pending at this checkpoint; selection alone is not
release evidence.

## Published 701 And Outermost DMG Correction

Run 36630173322 publishes `desktop-latest-v0.2.701` at 2026-09-29
21:41:08 UTC from `ef5e2f31`. All five package legs and collector pass.
Independent public download verification checks all 13 SHA256SUMS entries,
GitHub asset digests, the immutable tag source, and all ten unique updater
payload signatures using the checked-in public key and `minisign -V`.
The manifest has 15 platform aliases. Native About/updates installs 701 over
signed 501 on all three guests; Mac/Linux sentinel and native-host bundle/copy
hashes match, correct default Chrome for Testing manifests appear, and host
directories become mode 0700. Windows installed app and both helper copies
have valid Kyle Graehl Authenticode signatures. Full lifecycle qualification
remains in progress.

An independent outer-container check catches a release pipeline omission:
`xcrun stapler validate RSTorrent_0.2.701_aarch64.dmg` has no ticket, and
`spctl --assess --type open --context context:primary-signature --verbose=4`
rejects it as `Unnotarized Developer ID`. The app inside passes deep/strict
code signing, execute assessment and stapled-ticket validation. The identical
app in the signed updater archive is also notarized. Do not confuse an app's
ticket with a DMG's ticket, or replace published 701 assets in place.

Apple's [packaging guidance](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
and [custom workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
require submission of the distributed outer container; [TN2206](https://developer.apple.com/library/archive/technotes/tn2206/)
specifies the disk-image assessment context. Inspect pinned Tauri CLI 2.11.4
`crates/tauri-bundler/src/bundle/macos/app.rs` (notarizes/staples app) and
`macos/dmg/mod.rs` (signs DMG without notarizing). Add explicit bounded
20-minute DMG submission using existing App Store Connect credentials, require
Accepted with no reported issues, retain submission/log JSON for 14 days,
staple/validate, and require the correct Gatekeeper assessment. This occurs
before final hashes/staging; the updater archive and its signature are
unchanged. Publish a new immutable Latest only after exact-source CI passes.

Correction checks: `actionlint .github/workflows/desktop-release.yml`,
`node --test scripts/validate-desktop-release.test.mjs
.github/scripts/desktop-release-artifacts.test.mjs` (17 tests), and
`git diff --check` pass. Local `xcrun notarytool submit --help` confirms the
team-key arguments, JSON result and bounded wait syntax. Actual notarization
and disk-image trust remain signed CI/public-artifact gates, not mocked claims.

## Installed 701 Behavioral Evidence (Before DMG Correction)

Correction commit `fc401ecf72936b073d0825644c94971b44718247` is pushed
normally; main CI run `36636558577` is in progress. It changes release gating,
not desktop behavior. Keep 701 behavioral evidence distinct from the future
corrected outer-container artifact.

Installed public package hashes:

| Payload | SHA-256 |
| --- | --- |
| macOS arm64 DMG (outer notarization fails) | `28eb18c52030e7be3d3e64309de1b110d3a3245f9832467d902bb888b8511cef` |
| macOS arm64 updater app archive | `41de9f572acd5087d5a885c21236f5b3d2463970efa4113c2058c8bae5f443b0` |
| Windows x64 NSIS | `67a33ebe970a6fff2148577f9a4538d4173cc83c0b463f6846e8c0dbfe7dd307` |
| Linux x64 AppImage | `dab4a701f33f417499d4310462a52010c44c72e47d87b3bbf7fe00919400213e` |

Architecture inspection precedes guest use: macOS app arm64/minimum 13.0,
helper arm64/minimum 11.0, installed on arm64 macOS 26.6.2; NSIS has an expected
32-bit bootstrap containing two AMD64 executables on Windows x64; Linux app
and helper are ELF x86_64, maximum required GLIBC 2.34 against Ubuntu 24.04.5
GLIBC 2.39. The Mac DMG and updater archive contain identical signed app/helper
bytes. Mac copied helper SHA-256 is
`8931f28ca68612bcd9a0f204e01a498cae0307a99801c8eea507685fadd6c953`;
Windows copied/bundled helper is
`6e9eefa1aea17517bbebddb9ba873838c496e6dc556d1d03d7e86ed95a7b07b5`;
Linux copied/bundled helper is
`b26296df0ca4932157c740fabd7b1771a3648e422b1b2140ccae4d42bfe1ace4`.

Use `scripts/verify-desktop-intent-lifecycle.mjs toolbar` against real Chrome
action popups, then `verify-desktop-extension-checkpoint.mjs clicks`, `invalid`,
`race`, and `prepare-limited`, and intent `incompatible`. All three pass:
12 repeated clicks leave one focused companion; 12 launch requests share one
instance; bad credentials disclose no library and protocol 999 is refused.
Independent native window/process/tray observations show one background owner
and no native product window before explicit desktop opening.

Three independent private seeds use current
`tests/interop/desktop_extension_seed.py --root TASK_ROOT --bind PRIVATE_GATEWAY
--seconds 1800`, the locked libtorrent 2.0.13.0 oracle and 256-KiB/s limits.
Add each torrent with checkpoint `transfer`, record the partial state with
`verify-desktop-suspension-recovery.mjs record BASELINE_JSON`, then issue real
CDP `Browser.close` via intent `browser-close`. Partial snapshots are Mac
194/512, Windows 12/512, Linux 11/512 pieces. The first Mac record invocation
omitted BASELINE_JSON and failed after checking partial state; repeat with the
required path before the recorded browser closure. No product change follows
that harness invocation error.

All three external files reach 33,554,432 bytes and SHA-256
`99080b09c925782f67975d36476f171ee4e8b367e2a893d07a88bd70028b3fe8`
**while their browsers remain closed**. Windows reads with `FileShare.ReadWrite`;
Mac/Linux use `shasum -a 256`/`sha256sum`. Reopen the same browser profile,
then `recover BASELINE_JSON` and `complete BASELINE_JSON PAYLOAD` pass with
identical instance/root/torrent IDs and all 512 verified pieces. Native windows
remain unopened during the detached interval. Sampled background RSS is Mac
103,712 KiB, Linux 88,724 KiB, Windows 36,253,696 bytes/249 handles; these are
samples, not endurance high-water bounds. Stop all three seeds and remove
only their owned firewall rule afterward.

Linux's first restarted-browser recovery waits behind GNOME's “Choose password
for new keyring” dialog: native attach succeeds while browser WebSockets have
no connection. Independent capture identifies the modal; Cancel dismisses it
without creating/changing a keyring, after which passive recovery passes with
the original runtime. Record this test-browser setup interruption, not a
runtime restart or a silently ignored timeout.

Native picker selection adds fresh `root-two`; Mac and Linux also pass Cancel
and extension-tab detach with helper termination and unchanged owner. Windows
Cancel/detach pass; selection passes after fixing the temporary UI driver to
use `text` for `set.value` and native global snapshot references (window-scoped
Cua references are rejected by the native ValuePattern route). Mac AXPress
reports -25204 when a successfully clicked panel destroys itself; independent
root addition/cancel UI and process exit establish the action's effect.

Normal OS launches expose the native view of the same completed torrent.
Extension Pause followed by native Start converges on all three platforms.
Mac tray Open also exposes the native UI after a cold 12-request launch race.
Mac Quit during an outstanding picker removes runtime/helper; checkpoint
`stopped` observes 35 seconds, explicit `start` works, and `stale` refuses the
previous in-page credential. A second Quit followed by intent `passive-stopped`
passes two page reloads, two service-worker stops and 35 seconds without
resurrection. Mac actual default-profile manifest deletion produces browser
HostNotFound; normal desktop launch repairs it and browser hello succeeds with
byte-identical signed host. Windows and Linux also pass outstanding-picker Quit, 35-second stopped
observation, explicit Start, stale refusal, then a second Quit and the full
passive-stopped test. Independent Windows process enumeration reports zero
runtime/native-host processes after Quit. Their subsequent cold 12-request
races each produce one background owner; real tray Open exposes the native UI.
Linux default manifest deletion/HostNotFound/normal-launch repair preserves
host bytes. Windows Chrome falls back to the Chromium registration when only
the Chrome key is deleted; removing both task registrations produces
HostNotFound, and normal desktop launch repairs both. Do not mistake successful
fallback for failed repair. Native Windows Downloads independently shows both
controlled roots and the same completed torrent.

Public read-only route probes for all five target/architecture pairs at this
checkpoint: current 701 with `?channel=latest` returns 204; an older version
with `?channel=stable` or no channel returns Stable 0.1.4. Earlier 501 Latest
requests offer 701 with the exact immutable signed payload URL. Stable and
legacy channel-less routing remain unchanged.

## Corrected Release Dispatch

Main CI [36636558577](https://github.com/kzahel/rstorrent/actions/runs/36636558577)
passes all ten required jobs at correction source
`fc401ecf72936b073d0825644c94971b44718247`. Recheck the remote main SHA,
then dispatch `gh workflow run nightly-desktop.yml --ref main -f force=true`.
Corrected Nightly [36640704946](https://github.com/kzahel/rstorrent/actions/runs/36640704946)
starts at that source. Local evidence-only commit `8ec85e76` is not pushed and
does not replace the verified release source. Publication and downloaded
outer-container verification remain pending at this checkpoint.

Before the signed-build wait, native Quit and CDP Browser.close stop owned
apps/helpers/browsers. Park the guests (macOS suspended; Windows/Linux off)
and release the first claims. Controlled task-only libraries/backups remain
for the next installed phase; this is not final cleanup. Take fresh claims
and recheck those files/state before continuing. Independent backup audit
verifies all 315 preserved Windows file hashes; Linux inherited lock=false
and idle-delay=0 remain unchanged.

Selector job 109652044937 chooses desktop-latest-v0.2.801 from exact
fc401ecf. First-phase parking succeeds with zero owned processes:
macOS reaches suspended, Windows/Linux off; all three claims are released.
No inherited library is removed. Final qualification starts with fresh claims.

For the subsequent disposable Linux browser run, explicitly select
`--password-store=basic`, as documented in pinned Chromium 151.0.7922.34
[`docs/linux/password_storage.md`](https://raw.githubusercontent.com/chromium/chromium/151.0.7922.34/docs/linux/password_storage.md).
This test-only profile stores no user passwords; the flag makes the fallback
used after Cancel explicit and avoids creating an OS keyring. Keep Chromium's
sandbox enabled and the VM credential in Machine Control's canonical registry
file. This is test-browser setup, not a product or normal-browser policy.

## Corrected Public Release And Native Updating

Corrected Nightly 36640704946 completes successfully and publishes immutable
Latest 0.2.801 from fc401ecf at 23:19:13 UTC. Independent public checks and
all package hashes are in [the release evidence](../evidence/desktop-latest-v0.2.801.md).
Both macOS outer DMGs now pass notarization/stapling and Gatekeeper open
assessment, alongside their apps and bundled signed helpers. All ten updater
payload signatures and all 14 GitHub asset digests pass. Latest briefly returns
701 immediately after publication; subsequent ordinary checks offer 801 on all
five routes. Stable/channel-less requests remain 0.1.4.

Fresh read-only doctors confirm macOS suspended and Windows/Linux off. New
exclusive claims and `target ensure-ready` restore the sessions; Windows uses
its registry-located stored credential through common `testbed -- login`.
Native About/Check/Install and restart completes **701 → 801** on all three,
with existing extension pages reattaching to new owners and stale prior
credentials refused. Both root IDs, the completed fixture, schema and sentinel
survive. The native-host private directories remain 0700 and copied Unix
executables 0755; browser-default registrations match app-owned manifests.
Windows app, bundled host and versioned copied host all report Authenticode
Valid for the expected publisher. Architecture inspection precedes guest
installation: Windows inner executables AMD64; Linux app/helper ELF x86_64 with
maximum GLIBC 2.34, below guest 2.39; macOS app arm64/minimum 13.0 and helper
arm64/minimum 11.0.

The claimed Mac also validates the exact downloaded DMG ticket/open assessment,
mounts it read-only, quits the updater-installed app, and copies its app to
Applications with `ditto`. App/helper bytes compare identical to the updater
installation. Removing only task-owned native-host state and the actual CFT
manifest before normal first launch proves bundled-host installation and
registration: browser hello succeeds and the regenerated signed copy matches
the bundle. Gatekeeper remains enabled; this is command-driven DMG installation
and explicit assessment, not a claimed browser-download quarantine experiment.

## Final 801 Installed Matrix

Repeat the full bounded matrix on the exact published 801 installations, using
beta extension 0.4.0 (`gcgoepclopkgijmclmlheafaglmbjlcc`, unchanged package
SHA-256 `a21fb6e52ee720a83987d0b5094a60e1a338014c024cdaa977cbcadd47538533`).
CFT 151 is separately identified on all three guests; Mac/Linux use their actual
default test-browser profiles. No primary host browser is launched.

| Check | macOS arm64, Windows x64, Linux x64 result |
| --- | --- |
| Cold toolbar launch | One background owner; native window absent; tray/status item retained. Toolbar harness exercises the actual Chrome action popup, not a physical toolbar pointer click. |
| Repeated/warm launch | 12 clicks reuse/focus one companion page; 12 concurrent launch requests resolve to one instance. A later cold race also passes on each OS. |
| Authentication | Valid shared-library snapshot; invalid token and protocol 999 refused; credentials retained across update or Quit/relaunch are refused after rotation. |
| Controlled background transfer | Remove only the known controlled torrent with `reset-transfer`, add fresh fixture metadata, record partial state, close the real browser, independently hash completed bytes before reopening. All three pass. |
| Reattach | Same instance, root IDs and torrent ID after browser closure; 512 verified pieces and 33,554,432 independently verified bytes. |
| Native UI | Normal OS launch and real tray Show expose one native window; the controlled torrent is shared. Extension Pause, native Start and extension convergence pass. |
| Native picker | Fresh root-three selection, Cancel, page detach and outstanding-picker Quit pass; no abandoned picker helper remains. |
| Explicit Quit | Native tray action joins runtime/helpers. 35-second stopped observation offers Start; explicit Start works and stale authentication fails. A separate 2-reload/2-worker-stop/35-second passive test does not resurrect the runtime. |
| Registration repair | Delete only actual CFT manifest (Mac/Linux) or both Chrome/Chromium HKCU host keys (Windows); actual browser HostNotFound, then normal launch repairs and browser hello succeeds with expected helper bytes/trust. |

Exact scripted phases remain reproducible through:

```sh
node scripts/verify-desktop-intent-lifecycle.mjs toolbar
node scripts/verify-desktop-extension-checkpoint.mjs clicks
node scripts/verify-desktop-extension-checkpoint.mjs race
node scripts/verify-desktop-extension-checkpoint.mjs invalid
node scripts/verify-desktop-intent-lifecycle.mjs incompatible
node scripts/verify-desktop-extension-checkpoint.mjs prepare-limited
node scripts/verify-desktop-extension-checkpoint.mjs reset-transfer
node scripts/verify-desktop-extension-checkpoint.mjs transfer
node scripts/verify-desktop-suspension-recovery.mjs record BASELINE_JSON
node scripts/verify-desktop-intent-lifecycle.mjs browser-close
# Independently hash PAYLOAD while the browser remains closed, then reopen CFT.
node scripts/verify-desktop-suspension-recovery.mjs recover BASELINE_JSON
node scripts/verify-desktop-suspension-recovery.mjs complete BASELINE_JSON PAYLOAD
node scripts/verify-desktop-extension-checkpoint.mjs picker
# Drive real OS selection/Cancel, or detach/Quit while picker is outstanding.
node scripts/verify-desktop-extension-checkpoint.mjs picker-cancelled
node scripts/verify-desktop-extension-checkpoint.mjs detach
node scripts/verify-desktop-extension-checkpoint.mjs open
node scripts/verify-desktop-extension-checkpoint.mjs pause
# Native Start, observed through platform accessibility, then:
node scripts/verify-desktop-extension-checkpoint.mjs ui-running
node scripts/verify-desktop-extension-checkpoint.mjs remember
# Real native tray Quit while a picker is outstanding, then:
node scripts/verify-desktop-extension-checkpoint.mjs stopped
node scripts/verify-desktop-extension-checkpoint.mjs start
node scripts/verify-desktop-extension-checkpoint.mjs stale
# A second native Quit, then:
node scripts/verify-desktop-intent-lifecycle.mjs passive-stopped
```

Run these inside the claimed guest with its existing CFT CDP endpoint and
`RSTORRENT_PLAYWRIGHT_MODULE`, `RSTORRENT_TEST_TORRENT_FILE` and
`RSTORRENT_TEST_TORRENT_NAME` pointing at the controlled fixtures. OS actions
use common Machine Control `testbed -- ui` (AX/AT-SPI), Windows native UIA and
fresh scoped Cua references, native keyboard input for folder paths, and actual
tray actions. Linux's tray action uses the freshly discovered exported
StatusNotifier/DBusMenu label and ID. Delivery acknowledgments alone are not
passes: root snapshots, cross-view state, process exits and bytes provide
independent effects.

The new transfers start from 11/512 pieces on Mac/Linux and 12/512 on Windows.
Each uses an independent bounded 256-KiB/s seed from the pinned libtorrent
2.0.13.0 oracle; all reach SHA-256
`99080b09c925782f67975d36476f171ee4e8b367e2a893d07a88bd70028b3fe8`
with the browser closed. The temporary Unix process assertion initially matches
its own command text; switch to executable-name observation and repeat before
browser reopening. Windows's first independent post-Quit process check arrives
after the scripted explicit Start; repeat Quit with an outstanding picker,
then check zero processes before the passive test. Neither harness-ordering
error is product-failure evidence. Mac's first native Start lookup precedes
WebView accessibility hydration; a fresh tree shows the paused controlled row,
and the subsequent native Start plus extension observation passes. The known
AXPress -25204 on successful picker destruction is again independently resolved
by the added root and helper exit. Linux's explicit disposable password-store
flag avoids the earlier keyring modal without disabling the browser sandbox.

801 registered/bundled helper SHA-256:

- Mac arm64: `07aa29020f8a4fe8fcd709999f10750a6eeebc846986b93a4c232e63f6cfb1ae`.
- Windows x64: `cc0ef858eb9d5be1aeb4111db327f43096e485baf051c4ec9af2e2a267fe0292`.
- Linux x64: `b26296df0ca4932157c740fabd7b1771a3648e422b1b2140ccae4d42bfe1ace4`.

No product implementation changes follow the final installed matrix. The
correction between 701 and 801 changes DMG delivery gating, and the two
immutable artifact cohorts retain distinct evidence above.

## Final Cleanup And Next Actions

Real native Quit and CDP Browser.close leave no owned runtime, picker, native
host or CFT processes. All six bounded fixture seeds (701 and 801 phases) are
joined; both temporary artifact servers and their owned firewall rules are
removed. The controller firewall returns to its seven inherited rules.
Task captures, downloads, mounted-image work directories, fixture bytes,
helper scripts and task roots are removed; build caches are retained.

Windows restores its three inherited app/profile directories with all **315
file hashes** and counts verified, plus **seven registry exports** compared
after restoration. Its two inherited shortcut paths retain working targets to
the restored app. Their copies were captured after baseline installation, so
this is functional shortcut preservation, not pre-install shortcut-byte proof.
The task installation/profile/browser directory is removed before shutdown.

Linux removes only the added `libfuse2t64` package; the complete package/version
inventory matches its pre-task baseline afterward. Remove the fresh product/CFT
profiles, task handler and originally absent mimeapps file, exact owned
captures and temporary files. Preserve inherited lock-enabled=false and
idle-delay=0; the recreated appliance and its canonical stored credential remain.
macOS unregisters only task-owned app/CFT bundles, removes their fresh profiles,
preferences, caches and task files, and verifies LaunchServices handlers still
match the inherited empty-handler export without rewriting it. Inherited apps
and unrelated guest state remain intact.

Return macOS to suspended and Windows/Linux to off, then release all claims.
Machine Control's bounded stored-login guide correction remains committed in
its repository as `71a0865`; no Machine Control push is performed. RSTorrent's
release implementation/source commits are pushed as required for the authorized
CI publication; subsequent evidence-only commits remain local.

This closes the requested **signed current-source desktop-control checkpoint**.
macOS uses the notarized DMG for initial installation and signed app archive
for updating; its app bundles the signed native host and installs/registers a
private per-user copy. No separate helper installer or routine code-entry
pairing is introduced.

Next independent work: bounded interrupted-update/recovery evidence, native
physical sleep/wake and a defined broader browser/runtime endurance campaign.
Intel/minimum-supported macOS installed coverage, original legacy replacement,
ChromeOS coordinated shipment and production graduation remain separate gates.
Tactical 233 is unchanged fixture context. Do not begin the importer until its
stream is discussed; no personal migration has run.
