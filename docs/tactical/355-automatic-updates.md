# Tactical 355: Automatic Updates

Status: Proposed, 2026-10-14. Maintainer direction to invest in robust
automatic updating so the compatibility horizon of Tactical
[354](354-mixed-version-compatibility.md) can tighten; planning only.
Topics: `beta-release-readiness`, `product-surfaces-and-migration`,
`runtime-configurations-and-headless-deployment`, `client-surfaces`.

## Problem

No surface installs updates on its own, so old hosts linger and the
compatibility horizon has to stay wide:

| Surface | Today | Reach |
| --- | --- | --- |
| Desktop: macOS `.app`, Windows NSIS, Linux AppImage | The web UI checks 5 s after launch, then every 24 h (Stable) or 30 min (Latest), only while the app runs (`clients/web/src/inspection/updater/schedule.ts`). Install needs **Install & Restart** or the dismissible banner (`AboutUpdatesSettingsSection.tsx`, `App.tsx`). | Days to weeks |
| Desktop: Windows MSI, Linux DEB/RPM | No in-app check or install (`updater/policy.ts`). | Manual reinstall only |
| Android | Play auto-update with staged rollout; no in-app prompt. | Days to weeks |
| Extension | Chrome Web Store auto-update. | Hours to days |
| Headless | `update --check` / `--apply` by an operator; the web UI shows the command (`rstorrent-headless/src/updater.rs`). | Operator-dependent |
| Crostini (legacy package) | No updater; re-run the bootstrap. | Manual |

Hosts already report their version in the hello (Tactical
[353](353-host-product-in-hello.md)), but nothing compares it with releases
or tells a remote user the host is behind.

## Maintainer Decisions

Two items reverse Tactical
[343](343-about-support-and-remote-updates.md)'s non-goals and need explicit
approval:

1. **Unattended desktop install.** *Recommended:* download in the background
   when a check finds an update and install on quit or next launch, with a
   visible notice and a Settings opt-out (default on). 343 lists "automatic
   install without an explicit owner action" as a non-goal.
2. **Play In-App Updates on Android.** *Recommended:* add
   `com.google.android.play:app-update` and use the flexible flow when the
   installed version is behind. 343 lists it as a non-goal and a new
   dependency with tradeoffs.

## Scope

- **Desktop check ownership.** Move the periodic check from the web UI into
  the Rust host so it runs whenever the app runs, including with no window
  open; the UI only presents state.
- **Background download and install on restart** (decision 1), verified
  against the existing updater trust root and signature checks; a failed or
  interrupted download leaves the installed version untouched and retries.
- **MSI and DEB/RPM.** Steer new installs to the self-updating formats and
  show existing package installs an in-app "update available" notice with the
  manual path; no package-manager integration.
- **Headless.** An opt-in automatic apply (a systemd timer from the release
  installer or an in-process timer) using the existing `--apply` path, with
  restart and rollback behavior already owned by the headless updater.
- **Crostini.** Complete the planned move to the AppImage so it shares the
  desktop updater; until then, show the notice.
- **Android.** Play In-App Updates flexible flow (decision 2), shown when the
  installed version is behind the published one.
- **Uptake evidence.** Record which versions connect, without new telemetry
  beyond what the product-state disclosure already allows, so tightening the
  354 horizon rests on observed reach. If no permitted signal exists, the
  horizon stays at 30 days.

## Non-Goals

- Forced updates or blocking use of an old version.
- Updating the Chrome extension outside the Web Store.
- Package-manager repositories for DEB/RPM.
- iOS, which follows App Store updates.

## Invariants

- Only artifacts signed by the existing JSTorrent updater trust root install.
- An update never interrupts active work without notice; install happens at
  quit or next launch, or on explicit request.
- Shipped user data follows the Durable User Data rule: every update migrates
  the catalog forward (Tactical 345); none resets it.

## Validation

- Desktop: signed update from the previous release on macOS, Windows NSIS and
  Linux AppImage, unattended, including interrupted download and failed
  signature cases.
- Headless: timer-driven apply and rollback on a test host.
- Android: flexible in-app update against an internal-test track build.
- Docs: `beta-release-readiness` and `product-surfaces-and-migration` record
  the update paths and evidence.

## Stopping Condition

Complete when desktop updates install without a click on the self-updating
formats, headless can update itself when opted in, Android prompts through
Play In-App Updates, the remaining formats show a notice, and the owning
topics record the evidence and the observed uptake that 354's horizon uses.
