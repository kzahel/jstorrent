# Tactical 343: About, Support And Remote Parity

Status: Proposed, 2026-10-14. Maintainer-requested plan; no implementation
or commit authorized yet. Each numbered slice below becomes its own tactical
when it starts.
Topics: `client-surfaces`, `web-ui-design`, `application-view-api`,
`remote-access-authentication`, `product-state-and-feedback`,
`download-roots`, `android-jstorrent-replacement`,
`runtime-configurations-and-headless-deployment`.

## Problem

Settings shows **About & updates** only when the host injects a
`DesktopUpdater` (Tactical 158's rule). Only Tauri desktop and the headless
server do that. Every other surface has no version, build, support links or
diagnostics: a browser connected through desktop remote access, Crostini,
the ChromeOS companion page for Android, the demo, and the Android Compose
app. That rule tied "About" to "this host can update itself". Version and
support facts belong on every host. Update controls belong where a host can
act on them.

A remote browser is also a second-class owner. It cannot update the host, add
or repair a download folder, restore defaults or clear data. Some actions it
can take, such as removing a download folder, cannot be undone from where it
is.

## Maintainer Decisions, 2026-10-14

- **There are no permission levels.** Every authenticated client may call
  every application API operation, remote or local. The host does not filter
  commands by transport.
  - Remote-access provisioning and recovery (enable, recover, change
    passphrase, disable) stay as `remote-access-authentication` defines them.
    That is security setup, not an application permission tier.
- **The UI handles remote consequences instead.** It may hide an action only
  when using it would disconnect the remote user with no way back. Otherwise
  it warns about what the action does to a remote session, such as resetting
  remote-access credentials.
- **Remote recovery must work.** Anything a remote owner can break by
  accident, they must be able to repair remotely. In particular, a download
  folder can be specified by typing a path rather than only through a native
  chooser.
- **Every UI has Quit.** A deliberate quit is allowed everywhere, including
  remote sessions, after a confirmation that says what stops and how the host
  comes back. Android already has **Shutdown**.
- **Remote updating is allowed** for any signed-in remote browser.
- **Remote update covers every host that owns its own updates.** The desktop
  app accessed remotely is the priority. Platform-managed updates (Play,
  MSI/DEB/RPM packages) only show status and a link.
- **Headless updates from the UI, later.** The headless service can
  eventually be updated from its browser UI, both check and apply. This
  reverses Tactical 171's non-goal. It ranks below desktop because headless
  is not publicly distributed yet.
- **Profile means identity and build type.** That is the app identifier and
  flavor, plus the profile ID and location.
- **Show the current profile,** and put profile, build version and engine
  commit in support diagnostics.
- **Android gets the About and support parity.**

## Current State

- **Version facts reach React only through the updater.**
  - `DesktopReleaseInfo` (`clients/desktop/src-tauri/src/updater.rs:20-27`)
    carries the version, build ID, target and arch.
  - The build ID is `RSTORRENT_BUILD_ID`, which only desktop CI sets
    (`.github/workflows/desktop-release.yml:267`). Local builds say
    `development`.
  - Headless sets `build_id` to the version string
    (`crates/rstorrent-headless/src/updater.rs:241`).
- **`ApiHello.backend` is mostly unpopulated.** `ApiHello` already has an
  optional `backend: ApiBackendIdentity`
  (`crates/rstorrent-session/src/views/contract.rs:132-150`).
  - Only the desktop control loopback and the Android companion fill it, and
    only on the WebSocket `connected` frame. Its `profile_id` is always
    `"default"`.
  - Android's companion reports `CARGO_PKG_VERSION` `0.1.0` instead of the
    app's `versionName` (`crates/rstorrent-android/src/lib.rs:1089,1099`).
    That is a bug.
  - `LiveApplication` keeps the hello private, so React never sees it.
  - The generated `ApiHello` schema does not reject unknown properties, so an
    added optional field is safe for older clients.
- **No profile identity is exposed.** No API or Tauri command reports the
  app identifier, the flavor or the profile location. The flavors differ:
  - Desktop: production `com.jstorrent.desktop`, preview
    `com.jstorrent.rstorrent`, and isolated development identifiers
    (Tactical 337). The profile lives in `app_data_dir()/profile` and remote
    access in `app_data_dir()/remote-access`.
  - Android: release `com.jstorrent.app`, debug `org.rstorrent.bootstrap`,
    and qualification identities.
- **Diagnostics require an updater.** `buildDiagnostics`
  (`clients/web/src/inspection/support/diagnostics.ts`) takes a
  `DesktopUpdaterSnapshot`. Its build regex turns headless and local builds
  into `unknown`.
- **Android has no About screen.** Support (the feedback link) and the
  privacy policy sit under Settings → Advanced. There is no version display,
  no diagnostics copy and no Play update link inside the app.
- **Remote updating is not possible.**
  - Desktop check, install and relaunch are Tauri IPC commands from the
    local window, and the JS controller drives them.
  - The remote relay forwards application frames plus a closed list of
    security operations (`crates/rstorrent-remote-host/src/wire.rs:281`).
  - Headless apply is CLI-only, because the installer stops its own systemd
    unit. Tactical 171 lists web-triggered service replacement as a
    non-goal.
- **Reset actions are assembled in the client.** `App.tsx:606-660` builds
  Restore defaults and Clear app data from several separate steps:
  - the engine command (`ResetClientSettings` / `ClearAppData`);
  - update channel reset;
  - power and notification settings;
  - product privacy clear;
  - and, for Clear app data, turning off remote access and clearing its
    history.

  The non-engine steps go through Tauri-only bridges, which a remote client
  does not have. So the UI simply refuses both actions when the scope is
  remote. The engine command itself is already reachable from remote, because
  the relay only blocks uploads and media URLs
  (`crates/rstorrent-remote-host/src/runtime.rs:952`).
- **Download folders cannot be chosen remotely.**
  - `RemoteApplicationClient.chooseDownloadRoot` rejects with
    `unsupported_remote_capability`.
  - The gateway's `/api/v1/platform/download-root` opens a native dialog on
    the host's own screen.
  - The remote UI hides root management (`SettingsDialog.tsx:376`). Yet
    `RemoveStorageRoot` is reachable over the API, and a removed or missing
    root has no remote repair path.

## Definitions

- **Product info.** Facts a host reports about itself:
  - product name, product version and source commit (the engine build);
  - target and package kind;
  - app identifier and flavor (`production`, `preview`, `development` or
    `qualification`);
  - profile ID and profile location.
- **Profile.** The app identifier plus flavor tells which installation's data
  is in use. Profile ID and location name the database directory.
  - The profile location is shown in the UI to the owner (local or remote).
  - It stays out of diagnostics because of the no-paths rule.
- **Client build.** The web UI's own build. It differs from the host only for
  the separately deployed remote client (`VITE_RSTORRENT_REMOTE_BUILD_ID`)
  and the extension-hosted companion page.
- **Session-ending action.** An action after which the current remote
  session cannot reconnect without someone at the host. Examples: turning off
  remote access, clearing its credentials, shutting the host down.

## Update Ownership By Surface

| Surface | Who updates it | Today | Planned |
| --- | --- | --- | --- |
| Desktop macOS app, Windows NSIS, Linux AppImage | Our signed Tauri updater, Stable/Latest channels | Automatic check; installed only after the user approves, from the local window | Same, plus check and install from a remote browser (Slice 5) |
| Desktop Windows MSI, Linux DEB/RPM | Package or OS | Status only | Status only, locally and remotely |
| Headless Linux service | Our signed manifest and `rstorrent-headless update --apply` | UI checks; apply only from the server shell; no public artifacts yet | Apply from the UI, local or remote (Slice 6, later), then a self-updating Linux CLI that also replaces Crostini |
| Android (`com.jstorrent.app`) | Google Play | Not shown | Version shown plus a Play link (Slice 7) |
| ChromeOS companion page for Android | Google Play | "Update in Play" only when the versions are incompatible | Version shown plus a Play link (Slice 3) |
| Legacy Crostini package (`crostini-v0.1.0`) | Nobody: no updater; users re-run the pinned bootstrap. Frozen RSTorrent preview (Tactical 169, 289) | Not shown | Version shown with a note that this build is legacy and the Linux AppImage replaces it. No update work here; the planned self-updating Linux CLI absorbs it |
| ChromeOS Linux running the desktop AppImage | Our signed Tauri updater, as on the desktop row | As desktop | As desktop, including remote update (Slice 5) |
| Remote web client (jstorrent.com) | Website deploy | Not shown | Shows its own build next to the host's (Slice 3) |

## Slices

### Slice 1: Host-owned reset operations

**Goal.** Restore defaults and Clear app data work from any client, with
correct remote consequences.

- **One host owner.** Move the reset sequence from `App.tsx` into the host.
  Each host (desktop native, headless, gateway, Android) resets everything it
  owns in one operation:
  - engine settings and data;
  - update channel;
  - power and notification settings;
  - product privacy state;
  - remote access, when requested.
- **API shape.** Expose the operation through the application API with an
  explicit `remote_access: keep | reset` choice.
  - It replaces the client-side orchestration and the local-only bridge
    calls.
  - It keeps the existing refusal when torrents still retain data.
- **Remote presentation.**
  - Remote sessions default to `keep`.
  - Choosing `reset` is labelled as session-ending, with a warning that this
    browser and every other remote browser will be signed out and remote
    access must be re-enabled at the host.
  - Local sessions keep today's behaviour, which resets remote access.
- **Remove download folder.** Allowed remotely with no extra warning once
  Slice 4 makes it recoverable.
- **Validation:**
  - Host-level reset tests per owner, covering keep and reset, including the
    retained-data refusal and partial-failure retry
    (`reset_incomplete`).
  - Component tests for the remote warnings.
  - A remote-session test that resets with `keep` and stays connected.

### Slice 1b: Quit from every UI

**Goal.** The web UI (local, browser-hosted and remote) gets a Quit action
with a confirmation. It stops the whole host product, not only the engine.

- **Current state.**
  - The web UI has no Quit.
  - Desktop quits from the tray and window lifecycle, through
    `application_shutdown` / `request_application_shutdown`
    (`clients/desktop/src-tauri/src/lib.rs:1458`), which also stops the
    remote runtime.
  - Android has a Shutdown action.
  - The engine's `Command::Shutdown` stops only the application service. Sent
    over the API, it would leave the desktop process, tray and remote runtime
    running with no engine.
- **Host-owned quit.** Add a quit operation that each host maps to its own
  orderly exit:
  - Desktop: `request_application_shutdown` (window, tray, remote runtime,
    engine).
  - Headless and gateway: a clean process exit. The systemd unit's
    `Restart=on-failure` does not restart after a clean exit.
  - Android companion: the existing Shutdown path.

  The existing shutdown gate and storage flush apply unchanged.
- **Confirmation copy depends on the session:**
  - Local: "downloads and seeding stop".
  - Remote: adds "you cannot reconnect until JSTorrent is started again on
    that computer".
  - Headless: adds that the service stays stopped until it is started on the
    server.
- **Clear ending for remote sessions.** The host sends a closing reason
  before it exits. The remote client then shows "Host quit" as a final state,
  rather than entering the reconnect loop or the "Host restarting" state from
  Slice 5.
- **Placement.** The main menu or toolbar overflow on every web host. The
  desktop tray Quit stays.
- **Validation:**
  - Host quit tests: desktop shutdown gate, headless clean exit code, gateway
    exit.
  - A remote-session test asserting the final "Host quit" state with no
    reconnect.
  - Component tests for each confirmation variant.

### Slice 2: Product info contract and build identity

- **One product-info type.** Add a `ProductInfo` struct to
  `rstorrent-session`. Each host supplies it when constructing the
  application service:
  - Tauri `lib.rs`
  - headless `runtime.rs`
  - gateway `main.rs` (Crostini and `scripts/webui`)
  - `rstorrent-android` from Kotlin
  - the demo
- **Delivery.** Add an optional `product` field to `ApiHello` on every
  transport: Tauri `application_view_hello`, HTTP `/api/v1/hello`, WebSocket
  `connected`, and the remote circuit, which forwards the gateway hello.
  - Fill the existing companion `backend.product_version` from the same
    source, which fixes the Android `0.1.0` bug.
- **Build ID.** Use one rule, `option_env!("RSTORRENT_BUILD_ID")` in one
  module, with `development` as the fallback. Set it in every release
  pipeline: desktop (already), headless, the Android Gradle → cargo build
  (also as a `BuildConfig` field), and the remote web client.
  - Headless `/healthz` and `HostedUpdateInfo` report the commit, not the
    version.
- **Client access.** `LiveApplication` exposes the product info as read-only
  state for React.
- **Generated contract.** Regenerate the TypeScript contract, add the
  validation rules (bounded strings and the flavor enum) and cover them with
  fixtures.
- **Validation:**
  - Contract fixtures.
  - Per-host unit tests that build the product info.
  - Tauri, headless and gateway hello tests.
  - An Android JNI config test asserting `versionName` reaches the hello.

### Slice 3: About & support on every web host

Client-side part complete in Tactical
[347](347-about-on-every-web-host.md): the always-on About tab, connection,
page build, desktop profile and diagnostics schema 2. Host version for remote
and Crostini sessions waits for Slice 2.

- **Always-on tab.** Settings always shows an **About** category. Rename it
  to **About & updates** only when an updater is present.
- **Sections:**
  - **Application:** host product, version, short commit, target, package,
    and connection kind (this device, remote host or companion).
  - **Profile:** identity and flavor, profile ID and profile location with a
    copy action. Development and qualification flavors are visually marked so
    a test profile cannot be mistaken for production.
  - **This page:** the client build. Shown only when it differs from the
    host, which happens for the remote client and the companion page.
  - **Updates:** the existing update UI where an updater exists. Hosts
    without one get a short line instead:
    - Android companion: "Updates come from Google Play" plus the Play link.
    - Crostini: the package channel note.
    - Remote host: filled in by Slice 5.
  - **Support:** the existing issue, report and privacy links on every host,
    plus the diagnostics preview, copy and download.
- **Diagnostics.**
  - `buildDiagnostics` takes a `SupportFacts` value: product info, client
    build, connection kind and optional updater state. It no longer takes
    `DesktopUpdaterSnapshot`.
  - Bump the diagnostics schema to add flavor, app identifier, profile ID,
    commit, client build and connection kind.
  - Fix the build regex so a commit or `development` is accepted.
  - Keep the 2 KiB cap. Still exclude paths, torrent data, peers and
    credentials, and still send no network request.
- **Docs.** Update `docs/user-support.md` (it currently says "About &
  updates" and desktop-only diagnostics) and the `client-surfaces` and
  `web-ui-design` topics.
- **Validation:**
  - Component tests per host shape: Tauri, headless, remote, companion and
    demo.
  - Diagnostics schema tests, including the byte cap and the exclusions.
  - Demo-mode screenshots.
  - Web typecheck, unit tests and localization check.

### Slice 4: Download folders by path

**Goal.** A remote owner can add, repair and choose download folders without
a native chooser.

- **API.** Add an application API call that adds, or repairs
  (`repair_root`), a storage root from a typed host path. An optional "create
  if missing" flag is included.
- **The host validates the path:**
  - absolute, bounded in length, no NUL bytes;
  - canonicalized;
  - is a directory, or is created when requested;
  - passes a write probe;
  - not inside the profile directory;
  - gets the same identity and duplicate rules as a chooser result.

  Errors are typed: not found, not a directory, not writable, inside the
  profile, already added.
- **Path help.** The host offers short suggestions: home directory, the
  default downloads directory, and the parents of existing roots. A
  general-purpose directory browser over the API is deferred.
- **Web UI.**
  - Download settings and the add dialog offer "Enter a folder path" next to
    "Choose folder".
  - On remote and headless sessions, where the native chooser is unavailable
    or would open on the host's screen, path entry is the only control.
  - Remote root management is no longer hidden.
- **Host applicability.**
  - Desktop (local and remote): yes.
  - Gateway/Crostini: yes, because a browser there cannot see a host dialog.
  - Headless: its roots are owned by its TOML configuration. Path entry is
    not offered there until the headless runtime topic accepts dynamic roots.
  - Android: not applicable, because SAF requires its picker and Android has
    no remote-access server.
- **Validation:**
  - Path validation unit tests, including symlinks, an existing duplicate, a
    read-only directory and a path inside the profile.
  - Gateway API tests.
  - A remote-session test that removes a root and adds it back by path, with
    torrents on it resuming.

### Slice 5: Remote update, desktop first

**Goal.** A signed-in remote browser can check for and install a desktop
update, and the session resumes after the host relaunches. This is the
priority update slice.

The remote operations are defined independently of the host, so any host
that owns its own updates can plug into them later. Headless does so in
Slice 6.

- **One native update owner.** Move the check → download → install →
  relaunch state machine out of the window's JS controller into a native
  owner in the desktop process. It holds the candidate generation, channel,
  progress and errors. The local window and remote sessions become two views
  of that one state.
  - The automatic check schedule moves with it, so a closed window still
    checks.
- **Remote operations.**
  - Add a product-update operation family to the relay wire: status
    subscription, check and install-and-restart. Channel selection moves too,
    since there are no permission levels.
  - Each operation is recorded in remote security activity.
  - Advertise them through a capability so older hosts hide the controls.
- **Bundle types.** Only bundle types that already install in-app (app, NSIS,
  AppImage) offer remote install. MSI, DEB and RPM show "update on the host".
- **Confirmation.** Install requires a confirmation that says the host
  restarts and the connection drops briefly. Tactical 158's "installation is
  always an explicit user action" holds; the remote owner is the user taking
  that action.
- **Restart-aware resume.**
  - The remote client enters a "Host restarting" state and retries resume for
    up to about two minutes, instead of the current ~3 s before falling back
    to sign-in.
  - It must not classify a drop during the handshake as `resume_rejected`,
    because that clears stored authorization
    (`remote-application-websocket.ts:366-376`).
- **Version skew.** A host whose API or protocol version the remote client
  does not support gets a clear "this page is older or newer than the host"
  message, not a generic contract failure.
- **Risks to verify on hardware:**
  - The Windows NSIS install must not need UAC elevation. Nobody is at the
    host to approve it.
  - The macOS update must not hit translocation or a permission prompt while
    nobody is at the machine.
  - Install failure must leave the old version running and report the error
    to the remote view.
- **Validation:**
  - Native state-machine unit tests.
  - Relay wire tests.
  - A scripted remote session that drives a fake updater through relaunch
    and resume.
  - A real signed install over the relay on macOS and Windows NSIS between
    two published versions, using isolated test identities only. Never
    redirect production clients.

### Slice 6 (later): Headless check and apply from the UI

**Priority.** Lower than desktop. Headless has signed update machinery but no
promoted public artifacts or stable manifest yet, so nobody receives its
updates today. Schedule this slice after Slice 5, or when headless
distribution starts, whichever is later.

**Future direction.** The intended successor is one self-updating JSTorrent
Linux CLI that replaces both the headless and Crostini packages
(`runtime-configurations-and-headless-deployment`, "Self-updating Linux
CLI"). Build the detached apply and status file below as part of that CLI's
own updater, not as a headless-only path.

**Goal.** A browser connected to the headless service, whether through web
access or remote access, can check for an update and apply it. The service
comes back on the new version and the browser reconnects. This replaces the
copyable shell command as the primary path; the CLI stays.

This reverses Tactical 171's "web-triggered service replacement" non-goal.
The `runtime-configurations-and-headless-deployment` topic records the change
when the slice lands.

- **Why it can't run in-process.** `installer::install_bundle` runs
  `systemctl --user stop` on the service's own unit before swapping release
  links. It then restarts the service, probes health and rolls back on
  failure. Run inside the service's cgroup, the stop would kill the installer
  partway through.
- **Detached apply.** The service starts the installed
  `rstorrent-headless update --apply` as a transient user unit, for example:

  ```
  systemd-run --user --unit=jstorrent-headless-update-<id> --collect \
    <installed binary> update --apply --expect-version <candidate>
  ```

  - A transient unit lives outside the service's cgroup, so it survives the
    service stopping.
  - `--expect-version` pins the confirmed candidate, so a newer release
    published between confirmation and apply is never installed by surprise.
  - The existing health-checked install and rollback run unchanged.
  - Check at runtime that the service has a usable user manager:
    `XDG_RUNTIME_DIR` and `systemd-run` must be present. If not, keep showing
    the shell command and give the reason.
- **One update at a time.** A lock file under the install state directory
  prevents concurrent applies, whether from two browsers or from a browser
  and the CLI.
- **Status file.**
  - The apply unit writes progress and its outcome to a status file in the
    state directory (not `/tmp`, because the unit uses `PrivateTmp`). The
    outcome is one of: installed, rolled back with an error, or failed before
    stop.
  - The restarted service reads it and reports the last apply result through
    `GET /api/v1/product-update`. After a rollback, the old version reports
    the failure.
- **API.**
  - Add `POST /api/v1/product-update/apply`, with the same origin and session
    rules as the check endpoint.
  - The remote-access path uses the Slice 5 product-update operations, so
    both transports reach one host owner.
  - The headless updater in `headless-updater.ts` drops `manualApply` as the
    only path and gains `install()`. Policy then allows install for the
    `headless` bundle type when the host reports that apply is available.
- **Browser flow.**
  1. Check.
  2. Show release notes.
  3. Confirm with "the service restarts; torrents pause briefly".
  4. Apply.
  5. "Restarting service" until `/healthz` reports the new build. This shares
     the restart-aware reconnect from Slice 5 and extends it to the web-access
     WebSocket client.
- **Validation:**
  - Unit tests for the lock, the status-file transitions and the
    `--expect-version` mismatch refusal.
  - Gateway API tests.
  - A real headless install on a Linux host updating between two published
    test versions from the browser, covering both a successful update and a
    forced rollback.

### Slice 7: Android About

- **New screen.** Add a Settings → **About** route as the last hub entry. Move
  the Support and privacy-policy rows from Advanced into it.
- **Contents:**
  - Version (`versionName` and `versionCode`), commit, and flavor or
    application ID. A debug or qualification identity is visibly marked.
  - Profile ID and profile location.
  - The existing feedback flow and the GitHub issue links.
  - **Copy diagnostics,** using the same schema as Slice 3 and the same
    preview-before-copy rule, through the clipboard or a share sheet.
  - **Open in Google Play,** shown only for the `com.jstorrent.app` release
    identity.
- **Not included:** the Play in-app update API
  (`com.google.android.play:app-update`), which is a new dependency with
  tradeoffs and stays a separate decision.
- **Shared reset owner.** Android's existing reset paths adopt the
  Slice 1 host-owned reset owner where it applies.
- **Validation:**
  - Compose UI tests.
  - A diagnostics schema parity test against the web fixture.
  - Physical-device screenshot evidence under the Android parity gate.

## Ordering

- Slices 1, 1b, 2 and 4 are independent and can run in parallel.
- Slice 3 needs Slice 2. Slice 7 needs Slice 2.
- Slice 5 needs Slice 3, for the Updates section on remote hosts.
- Slice 6 needs Slice 5's shared update operations and restart-aware
  reconnect. It waits for headless distribution.

## Non-Goals

- Permission levels or per-transport command filtering.
- Automatic install without an explicit owner action.
- Remote updating of MSI, DEB or RPM packages.
- Android in-app updates.
- A general host filesystem browser.
- Dynamic headless roots.
- Uploading diagnostics or crash reports.
- Logs in diagnostics.
- New hosted-feedback transmission (those gates stay as
  `product-state-and-feedback` records them).
- Extension update control.
