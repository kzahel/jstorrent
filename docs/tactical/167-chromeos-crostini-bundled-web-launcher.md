# Tactical 167: ChromeOS Crostini Bundled Web Launcher

Current route amendment: Tactical [253](253-chromeos-onboarding-recovery-and-physical-qualification.md#primary-localhost-route-authorized-2026-10-04)
replaces the historical `penguin.linux.test:3030` authority below with the exact
`jstorrent.localhost:3030` loopback authority. Ownership, listener and browser
authentication policy are unchanged. The original execution record remains
historical evidence for the named-host route.

Status: **Complete as of 2026-08-26.** The exact local x86_64 package and beta
extension passed deterministic gates and the available physical Chromebook
matrix. The conditional full-reboot path was not exercised because the
testbed exposes no approved ChromeOS profile-login credential; no credential
was guessed or requested. Signed-release Tactical
[`158`](158-desktop-signed-packaging-and-updater.md) resumes as the sole
**Now**.

Topics: `product-surfaces-and-migration`, `client-surfaces`,
`application-connection-architecture`, `beta-release-readiness`

Dependencies: the mature React application in `clients/web`, the authenticated
same-origin gateway from Tacticals `101` and `109`, the beta extension identity
and package scaffold from Tactical
[`166`](166-desktop-native-bootstrap-and-extension-scaffold.md), ChromeOS Linux
application registration, systemd user services, and physical Chromebook
control through Machine Control's ChromeOS platform controller.

## Decision And Desired Outcome

Ship the first product-shaped RSTorrent backend for ChromeOS Linux. One
per-user Crostini package contains the Rust backend and the production React
bundle. The backend serves that bundle and the semantic HTTP/WebSocket API
from one same-origin listener; the extension is a launch, focus, setup, and
future browser-integration surface rather than the owner of the initial
control application.

The ordinary cold path is:

```text
ChromeOS Launcher entry
  -> wake Crostini and map a small Linux launch window
  -> start one static systemd user service on demand
  -> validate the exact local backend health response
  -> open http://penguin.linux.test:<fixed-port>/launch-chromeos
  -> wake the exact JSTorrent Beta extension service worker
  -> reuse/focus that browser tab at the backend-served React root
```

The extension cannot wake a fully stopped Crostini VM. Its own popup therefore
offers a warm open/focus action and truthful guidance to use the registered
**RSTorrent for ChromeOS Linux** Launcher item for a cold start. No extension
polling or enabled-at-login Linux service disguises that platform boundary.

## Scope And Stopping Condition

This tactical owns:

1. an explicit Crostini gateway mode that is separate from the existing
   loopback-only browser mode, binds the fixed package port, accepts only the
   exact `http://penguin.linux.test:<port>` browser origin and Host, and keeps
   the existing session/cookie authentication and bounded semantic API;
2. one exact health identity and protocol version plus a static
   `/launch-chromeos` handoff document that can message only the pinned beta
   extension ID and redirects no application authority from caller input;
3. a Linux-only `rstorrent-crostini` launcher/installer adapter with a small
   mapped X11 lifecycle, bounded health retry, exact product/protocol
   validation, `systemctl --user start --no-block`, and `xdg-open` handoff;
4. a static on-demand systemd user unit with no `[Install]`, enablement, or
   linger mutation, plus a `Terminal=false` `.desktop` entry and existing
   RSTorrent icon;
5. a no-sudo per-user package/install/uninstall flow that installs a matching
   gateway binary and production web bundle under owned, versioned paths,
   preserves the profile by default, and fails closed around unrelated paths;
6. extension external-message validation, cold handoff tab reuse/focus, a
   warm ChromeOS Linux action, bundled offline setup/recovery guidance, and a
   deterministic reviewed ZIP allowlist;
7. deterministic tests for origin/Host isolation, handoff HTML, health
   identity, launch retry/failure, installer ownership/templates, extension
   sender validation, tab reuse, and package contents; and
8. physical x86_64 Chromebook evidence for install, warm reuse, a fully
   stopped Crostini launch, repeated single-service/single-UI behavior, and a
   full ChromeOS reboot/login followed by Launcher wake when the testbed's
   approved login path is available.

The slice stops when an exact locally built package and matching unpacked
extension pass that physical matrix, the service and UI are independently
identified, active downloads survive presentation closure while the Linux
service remains running, and cleanup/preservation behavior is recorded. A
signed public Crostini release is not required.

## Security And Ownership Invariants

- The Crostini listener mode is explicit. It must not broaden bearer,
  development-none, Basic-authenticated, or ordinary local browser binds.
- The accepted browser authority is exactly
  `http://penguin.linux.test:<fixed-port>` with the port fixed by the package.
  Host and state-changing Origin checks remain exact; arbitrary Crostini IP,
  wildcard host, LAN, HTTPS downgrade, and caller-selected origin are rejected.
- The unauthenticated handoff page contains no token or mutable endpoint. It
  can wake only extension `gcgoepclopkgijmclmlheafaglmbjlcc` with one closed
  protocol-1 open message. Application calls retain the existing web-session
  policy.
- The extension validates the sender URL and message shape independently. It
  derives the backend root from constants and never accepts a destination URL
  from the page.
- The backend process owns the application service, profile, network, storage,
  view leases, and shutdown. The launcher owns only one finite start/health/
  handoff attempt. The extension and browser tab remain detachable views.
- Installation is per user and owns only its recorded application directory,
  stable executable link, desktop entry, icon, and service unit. Normal
  uninstall preserves the RSTorrent Crostini profile and downloads; explicit
  purge may remove only the recorded profile.
- The service is static and on demand. Installation must not call
  `systemctl --user enable`, `loginctl enable-linger`, or mutate account-wide
  lingering. Linger would not wake the ChromeOS VM and is not a substitute for
  the Launcher entry.
- All health responses, HTTP bodies, extension messages, retry counts, and
  filesystem inputs are bounded before state mutation or allocation.

## Fixed Product Contract

The initial package uses:

- application ID `com.jstorrent.rstorrent.crostini`;
- command `rstorrent-crostini`;
- static unit `com.jstorrent.rstorrent.crostini.service`;
- controller/application port `3030`;
- Chrome-visible origin `http://penguin.linux.test:3030`;
- product health identity `rstorrent-crostini` and launch protocol `1`;
- extension ID `gcgoepclopkgijmclmlheafaglmbjlcc`; and
- a distinct profile under the user's XDG data directory, separate from the
  desktop and Android profiles.

The service runs the application with online networking and a default path
root at Linux `~/Downloads`. ChromeOS folders enter only after the user chooses
**Share with Linux** and then adds a root through the existing product UI.
This tactical does not infer that similarly named Android or ChromeOS files
share capabilities or verified state.

The gateway health response adds stable product/protocol facts alongside its
existing build ID. The local launcher probes loopback but sends the canonical
`penguin.linux.test:3030` Host and rejects wrong product, protocol, or build
shape before opening Chrome.

The extension does not need `host_permissions` for the cold handoff. The
already opened `/launch-chromeos` page supplies its tab identity through
Chrome external messaging, and the worker updates that exact tab to `/`.
The worker may remember the last known tab ID with the `storage` permission so
a later extension-popup action can focus it without enumerating browser
history or reading unrelated tab URLs. If no remembered live tab exists, the
warm action opens the fixed root and explains that only the ChromeOS Launcher
can wake stopped Linux.

## Package And Lifecycle Shape

The source package builder creates one architecture-specific archive from:

- `rstorrent-crostini`;
- `rstorrent-gateway`;
- the production `clients/web/dist` tree built for same-origin live mode;
- the RSTorrent icon;
- the checked-in desktop and systemd templates; and
- a small installer entry point.

Installation copies immutable version contents, atomically advances a
relative `current` link, writes the stable command link and exact templates,
reloads the user service manager, and refreshes desktop caches when available.
It neither starts nor enables the service. Repairing the same version is
idempotent. The service remains running after browser or extension UI closure
and stops only through explicit service/application shutdown, Linux stop, or
uninstall.

## References And Adopted Lessons

The sibling `web-server-chrome` checkout was inspected at committed revision
`66a8c0ee95494f5b8632f7a2424a36e2da7495dd`. Its working tree contained
unrelated legacy-migration edits; the referenced Crostini files were not
modified. Exact inspected paths include:

- `desktop/crostini/src/lib.rs` and `src/x11_launcher.rs` for start-first,
  bounded loopback health validation and a mapped X11 Launcher lifecycle;
- `desktop/crostini/src/installer.rs` and `resources/*.in` for per-user owned
  paths, a static unit, relative version links, and no linger mutation;
- `desktop/crostini/src/controller.rs` for the local external-message page;
- `extension/src/lib/crostini-launch.ts` and its tests for exact
  `penguin.linux.test` sender validation; and
- `docs/topics/chromeos-crostini-launcher.md` for physical stopped-VM and
  reboot evidence, including the failure of direct `chrome-extension://`
  opening and windowless repeat launches.

RSTorrent adopts the product shape and may adapt the same maintainer-owned MIT
launcher/installer techniques with independently named contracts and tests.
It does not copy the web-server controller API, folder/server policy,
authentication tokens, updater, branding, or content-server lifecycle.

JSTorrent revision `25e4b701433fd815398ba89526546f5e4f072e3f`
was inspected for current Crostini history. Its standalone IO-daemon route,
`penguin.linux.test` discovery, and host-name-derived backend classification
confirm the need for an explicit backend kind and exact local route. RSTorrent
does not adopt its extension engine, IO daemon, takeover topology, mutable
profile store, or host-name inference.

This is product/platform integration. It changes no BitTorrent protocol or
engine state machine, so the pinned libtorrent feature-oracle pass is
inapplicable.

## Staged Implementation And Validation

1. **Decision gate:** land this tactical, queue reconciliation, and corrected
   backend-served Crostini UI direction before implementation.
2. **Gateway gate:** add the explicit Crostini host mode, health identity, and
   exact handoff route with deterministic positive and negative tests.
3. **Launcher/package gate:** implement the Linux launcher, owned install
   layout, static unit, desktop metadata, package builder, and temporary-root
   installer tests.
4. **Extension gate:** implement exact external-message/tab handling, warm
   guidance, offline setup page, permission/package validation, and a
   deterministic ZIP.
5. **Local build gate:** run focused Rust/web/extension tests and construct the
   matching Linux package without substituting a desktop Tauri backend.
6. **Physical gate:** use Machine Control's ChromeOS platform controller to
   install in the real `penguin` container,
   deploy the matching unpacked extension, and exercise warm, stopped-VM,
   repeated, and reboot launch paths with process/port/browser assertions.
7. **Closeout gate:** record exact commits, artifact hashes, ChromeOS and
   Crostini versions, screenshots/semantic evidence, lifecycle observations,
   and cleanup; reconcile topics and return **Now** to Tactical `158`.

The proportional source baseline is:

```bash
source ~/.profile
cargo fmt --all -- --check
cargo clippy -p rstorrent-gateway -p rstorrent-crostini -- -D warnings
cargo test -p rstorrent-gateway -p rstorrent-crostini
npm run typecheck --prefix clients/web
npm run test --prefix clients/web
npm test --prefix clients/extension
npm run package --prefix clients/extension
```

The physical matrix must additionally record exact installed hashes, one
service process, one application listener, the backend-served React title and
semantic tree, stopped `termina` before cold launch, post-reboot inactivity
before Launcher selection, and preservation/removal of every owned path.

## Completion Record

Implementation landed in four bounded commits:

- `4a0b04f` records the accepted package, trust, ownership, and lifecycle plan;
- `d15faf7` adds the explicit exact-authority Crostini gateway and handoff;
- `498297b` adds the launcher, static service, owned installer, and package;
  and
- `3cbaa5c` adds the exact-ID extension handoff, warm action, guidance, and
  reviewed deterministic ZIP.

The exact reviewed artifacts were:

- `rstorrent-crostini-0.1.0-x86_64.tar.gz`, SHA-256
  `8db3c4cfae0fccac014e8e68538013c7420d850089cf44ff8ff7a489fa95fd88`;
  and
- `jstorrent-beta-0.2.0.zip`, SHA-256
  `0d09c55d015987cd96cd594f6b1ab1db20189a796636569de2753a5dc4ff1a8a`.

The proportional source baseline passed: formatting; warning-denying clippy
for `rstorrent-gateway` and `rstorrent-crostini`; both Rust test suites; web
type checking and 279 passing web tests with two intentional skips; nine
extension tests; and two byte-identical extension package runs. The Linux
package was built and allowlist-validated inside the target container. Native
Linux clippy and all ten launcher tests passed there, including the two
Linux-only X11 lifecycle tests.

Physical evidence used ChromeOS `16700.60.0` milestone 150 on the
`nami-signed-mp-v13keys` x86_64 board and Debian 12.12 x86_64 in `penguin`.
The testbed doctor passed all ten required checks before and after the run.
The installed launcher and gateway SHA-256 values were respectively
`8a9d0b62b589bcd89ca34ebe58bdcdfc5792efbe9b648c38415107449a386861`
and
`42d9f72709368274e7103156430debe470bb6d32e531c4383f728f52ba5fa61a`.

The physical matrix established:

- install left the unit static and inactive, with one registered ChromeOS
  Linux Launcher item and the exact unpacked extension ID;
- a warm Launcher selection opened the backend-served React application,
  returned product `rstorrent-crostini` and launch protocol `1`, and repeated
  selection retained one service process, one listener, and one root UI tab;
- closing the tab left the backend running, and the extension's warm action
  reopened the UI against that same process;
- a controlled 16-MiB multi-file transfer continued from approximately
  272 KiB to 1.3 MiB with no UI target, then reappeared at later progress when
  the detachable UI was reopened;
- twice stopping `termina` made the endpoint unreachable; each cached
  ChromeOS Launcher selection woke Linux, produced exactly one UI target, and
  restored the interrupted torrent from the persistent profile;
- normal uninstall removed every owned application, command, desktop, icon,
  and unit path while byte-identically preserving the profile and an unrelated
  Downloads probe; reinstall restored the two torrent rows; and
- explicit purge removed only the Crostini profile and application-owned
  paths while byte-identically preserving the unrelated Downloads probe.

The full ChromeOS reboot/login case remains an explicitly unavailable
conditional, not inferred evidence: `machine-control` reports that this
ChromeOS target has no host-managed credential, while the testbed contract
forbids guessing or logging a PIN. All other required stopping evidence
passed. Final cleanup removed source, build, controlled-transfer, payload,
and probe artifacts. The device retains a clean package installation and the
reviewed unpacked extension; its service is inactive with `termina` stopped,
and no test torrent or payload remains.

## Non-Goals

- A public signed Crostini release, updater feed, rollback UI, website
  publication, Chrome Web Store publication, or production JSTorrent migration.
- An always-running standby daemon, socket activation, service enablement,
  linger mutation, boot start, invisible VM wake, or extension polling.
- Hosting the full React bundle inside the extension, making the extension the
  engine owner, native messaging from Crostini, Android remote control, or
  cross-backend state/profile sharing.
- LAN or Internet control, ChromeOS port forwarding, relay, HTTPS termination,
  account pairing, arbitrary origins, or a stable public wire protocol.
- Tauri window routing, desktop headless ownership, simultaneous desktop
  extension control, magnet protocol handling, or production extension code.
- Signed x86_64/ARM64 release breadth, automatic updates, older-distribution
  compatibility claims, suspend/resume guarantees, or performance parity with
  Android/desktop. These require later bounded evidence.

## Escalation Contract

Ordinary module placement, Linux template details, bounded X11 rendering,
installer mechanics, exact error wording, extension tab bookkeeping, and
testbed automation are in scope. Stop for maintainer direction if the work
would require a persistent enabled service, a broader bind/origin, new remote
authentication, another long-lived daemon, Android changes, public publishing,
release signing/tagging, modifying the production JSTorrent extension, or a
different backend/presentation ownership model.
