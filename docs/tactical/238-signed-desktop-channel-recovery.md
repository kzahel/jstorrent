# Tactical 238: Signed Desktop Channel Recovery

Status: **Complete bounded published-cohort matrix, 2026-09-29.** Campaign 231; follow-up to 230/237.
Topics: `beta-release-readiness`, `client-surfaces`, `desktop-jstorrent-replacement`.

## Scope And Evidence

Qualify selected existing signed Stable/Latest packages through installed
native update UI on macOS arm64, Windows x86_64 and Linux x86_64 where the
package lane supports it. Freeze published artifact hashes and source, verify
platform trust/signatures, select Latest explicitly, install/relaunch and
return to Stable without downgrade. Prove retained controlled external bytes;
record the package's catalog policy separately. Keep existing production
routes/keys read-only. No push, workflow dispatch, publication, tag, release,
key change, importer or personal migration.

Initial inventory included Latest 0.2.401 (80b04468); live channel discovery
offers 0.2.501 (7a4d7730), also before desktop extension control.
Therefore its installed updater evidence cannot qualify signed delivery of
232–237. Record incompatibility honestly and do not replace the newer beta's
controlled profile with the older published cohort. Use a separate fresh
controlled signed-cohort library and restore the beta cohort afterward.

## Ownership, Limits And Stopping Condition

Native update owner retains one signed candidate, invalidates it on channel
change and rejects unsupported package lanes. Existing joined restart owns
shutdown; no background updater/task added. Read official Tauri updater docs,
230 and the release runbook, current release assets and native source before
finalizing cases. Builder release source/tests precede installed evidence.

Stop after available signed platform checks, cancel/failure outcomes supported
by the existing UI, exact evidence and inherited-state cleanup. A missing
signed current-source candidate is an explicit remaining gate, not authority
to publish one. Guest policy or unavailable power states are recorded as
limitations. Retain no test credentials, servers, registrations or claims.

## macOS Signed Channel Evidence

Use a separate fresh signed-cohort profile/root; move the newer controlled beta
profile/app aside while stopped. Never open it with the older signed cohort.
The published 0.2.301 DMG SHA-256 is
`de3af97e66257001c77f4022e7fe3e43f8f1be68288bcb714e800ab49ee17139`
(source `30523da4b5bef2b3609d8491585a651733557c1f`). Read-only builder inspection
verifies arm64, minimum macOS 13.0, code signature and Gatekeeper acceptance.
Guest is macOS 26.6.2 arm64. A native folder dialog selects the controlled root.
Usage reporting is opted out through the native UI.

Selecting Latest in native About & updates discovers **0.2.501**, not the
initially inventoried 0.2.401. Re-inventory the already-published release:
source `7a4d7730920f84ed0c02374506b0cd4af1f26f2d`, published 2026-09-28.
`latest.json` SHA-256 is
`4b01c16c085869d20b327bd1c6e99a230953eec23c65aa7b01230887a24b5276`;
aarch64 updater archive is
`ddeac9ded764e2a0b7862e03b39142994a70e973a90420acddab0ba6c67720fa`.
The native **Install and restart** action downloads/verifies/installs and
relaunches 0.2.501 through the unchanged signed updater route. Its executable
SHA-256 `ee3f94cc839486f4f403f9e621877ae72918283cca4d4472c0e1bd4aa3bfe6f1`
matches the independently downloaded published archive. `codesign --verify
--deep --strict` passes; native About identifies the exact source/target.

The native Downloads view retains the controlled root; its external sentinel
retains SHA-256
`8981c074565ee7493567c1fa4a8d2913ba442bd308e3cddb20abd159c8b46974`.
Switching to Stable displays **Waiting for Stable to catch up**, preserves
0.2.501 and offers no downgrade. Native select interaction must retain current
guest focus while committing its menu selection; reactivating the application
between arrow/Enter can dismiss the popup without changing the channel.

This is successful published-cohort signed updating, not signed delivery of
232–239. No cancellation control is exposed during installation; cancellation
or interrupted replacement is not claimed from this happy-path run. Channel
candidate invalidation remains separately covered by 230's scripted tests.
No production route, identity, key, release or workflow was changed.

Real native Quit and owned browser shutdown precede cleanup. Owned app bundles,
profiles, manifests, browser support roots and payload are removed. The saved
LaunchServices dictionary is unchanged. The guest is returned to its initial
suspended state and its exclusive claim is released. Windows and recreated-Linux evidence follow below.

## Windows Signed Channel Evidence

The 0.2.301 NSIS installer SHA-256
`3eaba45249c02f35aa5cee1d0da13464a5a548c05fd39b4f7cecaeda7f47c9bf`
matches its published digest and `Get-AuthenticodeSignature` reports
**Signature verified**. Install into a separate fresh signed-cohort profile,
opt out of usage reporting, and select a fresh root through the native folder
UI. Select Latest, observe 0.2.501, and invoke **Install and restart**.
The single relaunched installed executable reports 0.2.501 and verifies its
Authenticode signature. Published 0.2.501 NSIS SHA-256 is
`17c43294a3ea6a100c743e8761ffb8a0021c2d153acc24c93c85963c08f5f9e9`.
Native Downloads retains the root and the independently read external sentinel
matches the macOS sentinel hash above. Stable selection displays **Waiting for
Stable to catch up** and keeps 0.2.501. No route/key/publication change.

Common Windows desktop snapshots may be rooted at the full desktop; depth 20
can omit nested About controls. Enumerate the actual RSTorrent HWND and use the
supported target-resident `testbed -- control` snapshot with that HWND, then
invoke its generation-bound references. No host browser/UI or global input is
used. Signature/version/hash and filesystem receipts are independent oracles.

Final native tray Quit precedes restoration: all 319 inherited file hashes,
eight registry keys/absence states and 1,482 builder source paths verify.
Task-owned installation, profile and browser artifacts are removed; caches are
retained. Windows is returned to its initial off state and its claim released.
The first Linux attempt stopped at the inherited screen lock; its AppImage/FUSE
preparation was not updater evidence. See 239 for that historical failure and
cleanup. The recreated-guest run below supersedes the blocker. No current-source
candidate is published under this tactical.

## Linux Signed Channel Evidence

The recreated, claimed Ubuntu 24.04.5 x86_64 guest passes Machine Control's
portable and installed resident smoke gates before product testing. Separate
the stopped current beta profile from a fresh signed-cohort profile; never open
the newer library with this older release. Use native privacy UI to opt out of
usage statistics and the real native folder dialog to select a fresh root
outside the boot-cleared temporary directory.

Published 0.2.301 AppImage SHA-256 is
`ae38f716f80c5ab2bea72449ed3ea2606560990ef0b741bafa951250b1d50d1f`.
`file`, `--appimage-extract`, `readelf --version-info` and `ldd` verify x86_64,
maximum required GLIBC symbol version 2.34 and all dependencies against guest
glibc 2.39 / WebKitGTK 2.52.6. Test-only `libfuse2t64` enables the AppImage lane.
Launch through common `desktop application launch --executable "$APPIMAGE"
--expect-target rstorrent-desktop` on the claimed guest; use generation-bound
AT-SPI actions for native settings and the folder chooser. Native About reports
0.2.301, source
`30523da4b5bef2b3609d8491585a651733557c1f`, target
`x86_64-unknown-linux-gnu`, package **Linux AppImage**.

Native **Update channel → Latest** offers **0.2.501**. Invoke **Install and
restart**; the signed updater replaces the AppImage and a single native process
relaunches. Its resulting AppImage SHA-256 is
`b6ce090248313e9752b7e505a976c6d58bc6496f63c92d6dc1102f173942670f`,
matching an independent download of the already-published 0.2.501 asset.
Native About identifies 0.2.501 and source
`7a4d7730920f84ed0c02374506b0cd4af1f26f2d`. Native Downloads retains the same
default root. An independently read external sentinel preserves SHA-256
`f869fbf0f9f7176e8baa3b1a2bf4657367aaeddc8d586724a5be609d45d2e5c0`.

Select **Stable** using the native combo popup's observed table-cell Activate
action. About shows **Waiting for Stable to catch up**, keeps 0.2.501 and offers
no downgrade. AT-SPI delivery alone is not proof: native captures establish the
offer/version/root/catch-up state, and process/file hashes independently verify
replacement and preservation. No updater cancellation control is present;
interrupted replacement is still unqualified. This older published cohort does
not qualify signed current-source extension control. Routes, keys and release
identities remain unchanged; nothing is published.

## Final Cleanup And Next Gate

Native tray Quit and real test-browser closure leave no owned runtime/helper/
browser process. Remove the task-only DEB, FUSE and Node packages, AppImages,
Chrome for Testing sandbox/profile, native-host registrations, handler and its
only MIME default, both fresh product profiles and their saved test backups,
controlled payloads, six captures and task scripts/logs. Remove the exact owned
controller server and three temporary firewall rules; the bounded seed ends.
The recreated VM and canonical stored credential are retained. Final doctor is
fully ready, stored password still matches the account, common shutdown reaches
off in 4.870 seconds, and the exclusive claim is released. Unrelated private
inventory SSH changes remain untouched; build caches are retained.

The bounded macOS/Windows/Linux published-cohort matrix is complete. Next gate:
signed delivery of the current desktop-control source when separately available,
plus interrupted replacement and broader update compatibility. Physical native
sleep and endurance remain separate; importer work waits for discussion.

## Signed Current-Source Follow-up

Tactical [240](240-signed-desktop-control-qualification.md) completes the next
signed-delivery gate with immutable Latest 0.2.801: five-target CI/public trust,
both notarized/stapled DMGs, native 701-to-801 updates and repeated installed
control/helper qualification on macOS arm64 and Windows/Linux x64. This does
not change 238's older-cohort scope. Interrupted replacement, physical sleep,
broader endurance and production migration remain open.
