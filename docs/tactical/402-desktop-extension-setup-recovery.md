# 402 — Desktop extension setup and upgrade recovery

Status: in progress, November 24, 2026.

Owners: `client-surfaces`, `desktop-jstorrent-replacement`,
`product-state-and-feedback`.

## Observed on Windows

The signed Desktop 0.3.12 x64 EXE and signed legacy Desktop 0.2.1 x64
EXE/MSI ran in a disposable Windows 11 Pro ARM64 build 26300 VM. Chrome
for Testing 158.0.8127.88 loaded the released extension 1.1.10 archive
with its production ID. Windows ran the x64 product packages via emulation.

| Flow | Observation |
| --- | --- |
| Clean EXE, files installed, before Desktop first starts | Chrome reports that the native messaging host is missing. The popup reports `native_host_unavailable` and disables Open torrent library. A manual first launch registers the host and the extension opens an authenticated empty library. The finish page checks Run JSTorrent by default. The clean wizard’s automatic launch was unverified. |
| Legacy EXE → current EXE, Do not uninstall | The new EXE installs alongside the old helper and daemon files. A live old helper blocks startup before catalog creation. The extension reports Desktop is ready even while Start times out and Desktop shows a separate migration dialog. An elevated helper also exercises the process-inventory refusal. |
| Retry after old helper exits | The extension starts Desktop 0.3.12 and opens the imported library. The generated torrent remains paused, independently verifies as present, and retains its infohash. The old logical database rows and the payload SHA-256 are unchanged. |
| Legacy MSI → current EXE, Do not uninstall | The verified selection launches the old MSI’s uninstall prompt twice. Declining returns to the upgrade screen. Locked Tauri CLI 2.11.5 routes the detected WiX install to uninstall ahead of the radio selection branch. |
| Current EXE uninstall | Chrome, Chromium and Edge keep the old native host registration pointing at the removed per-user refusal manifest. The current Chrome host registration is removed. |

The Windows feedback provides the symptom and version of the extension.
The VM reproduces that symptom before Desktop first starts and supplies a
separate, observed migration failure. No report identifies the submitter’s
installer, account setup or Desktop version.

## Scope and intended flows

- Distinguish the application’s first launch, a missing or moved Desktop,
  a healthy stopped Desktop, an accepted connection, a legacy startup
  block, and ordinary retryable startup failures. Reserve connected copy
  for a successful attach. Keep the existing toolbar launch intent on a
  healthy stopped install and preserve attach-only tab/reload behavior.
- Put recovery next to the failure. If the host is unavailable, explain
  how to open an installed Desktop on the user’s OS, link to the current
  installer for users who need it, and provide a manual Retry. Let the
  native helper classify owned launch config, missing targets and the
  product’s migration guard without delivering paths or exposing local
  process information. Give the matching failure and recovery in the
  companion page when it is already open.
- Keep native migration conservative. A verified active legacy owner or
  failed inventory blocks new startup before import. Preserve the legacy
  source and payload on refusal and retry. No silent process termination,
  new migration, user-choice takeover or automatic fallback to the old
  daemon.
- Give the Windows MSI replacement a truthful path through the EXE
  wizard. Preserve the existing removal/confirmation boundary for the
  detected MSI cohort and the ordinary choices for EXE upgrades. Cancel
  keeps the old install and library. Remove Windows native messaging
  registry entries only while they point at the app’s own manifests.
- Qualify the shared browser and startup behavior on macOS. Copying an
  app from a DMG cannot register Chrome for a user who has never opened
  the app. Preserve that per-user first-launch boundary and make the
  instructions match Applications. Exercise the missing/moved-bundle
  path and ordinary reopen/repair using an isolated macOS guest.

## Contracts and bounds

- Keep protocol v1 and existing request/response meanings. Prefer an
  optional bounded reason on the existing `control_unavailable` response
  over a new operation. Released clients can still use the existing
  error code and safe fallback message. A new client with an old host
  must offer a working Start path even when its exact state is unknown.
- Passive attach never starts a process. Use the existing per-connection
  frame limit and startup deadline. Keep the existing bounded process
  inventory and origin checks. Keep failure text and report categories
  closed and localized, without publishing app paths, contact details,
  credentials or customer records.
- Bootstrap and installer changes are desktop-specific. Shared React
  validation includes companion consumers. Android behavior and the
  generated application contract have no planned changes.

## Commit sequence and acceptance

1. Record the baseline and plan. Review the plan and each later staged
   chunk with the requested Opus 5.5 high-effort work-pool reviewer.
2. Add native state classification with deterministic tests, then wire
   it into popup and companion recovery. Exercise old/new native host
   pairs, explicit launch, attached and stopped states, missing host,
   blocked migration, recovery and diagnostic reporting. Capture the
   English text and actions from the real browser views.
3. Correct the Windows installer and owned registration cleanup. Exercise
   both installer formats through the Windows guest, including the MSI
   cancel/confirm path and EXE keep path. Confirm native registrations,
   preserved fixture data, and safe handling of a foreign registration.
4. Qualify installed browser and app flows on Windows and macOS. Save
   selected redacted screenshots and a brief report with exact copy,
   actions, versions, outcomes and validation limits. Keep larger or
   private traces out of the repository. Shut down and release claimed
   guest workspaces and reap task-owned browsers.

Stop after the changes and evidence land in reviewed commits. Package
qualification is local or in the claimed guests. Production publication is
outside this change.
