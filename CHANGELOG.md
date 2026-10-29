# Changelog

Notable desktop changes are recorded here. JSTorrent follows
three-component versions, and desktop release tags use
`desktop-v<version>`.

## [0.3.6] - 2026-10-29

- Choose from nineteen interface languages, with complete shared UI and native
  desktop translations available offline.
- Improve System-language matching for Brazilian Portuguese and both Chinese
  variants, and preserve keyboard focus when changing language.
- Improve browser handoff and optional diagnostic feedback context.
- Update cryptography and networking security dependencies.
- Reject inconsistent ZIP headers when importing torrent lists.
- Browser control continues to require JSTorrent extension 1.1.5 or newer.

## [0.3.4] - 2026-10-22

- Browse videos and music across torrents in the Library, with search,
  filters, albums, shows, and playback for completed local media.
- Export and import torrent lists, share richer links, and set seeding limits.
- Add download-safety controls and improve large file selections.
- Improve navigation, narrow layouts, file actions, and connection recovery.
- Add signed Stable and Latest updates with database compatibility checks,
  idle installation, and recovery protection for interrupted updates.
- Repair production browser-extension control and improve app diagnostics.

- Browser control requires JSTorrent extension 1.1.5 or newer.
- Update TLS certificate handling and build-tool security fixes.

## [0.3.1] - 2026-10-13

- Fix file-selection dialogs freezing when several torrents are queued, and
  start the remaining queued additions when file selection is turned off.
- Preserve torrent-list scroll position while transfer state updates.
- Open desktop support and release links through the native browser opener.
- Improve first-use disclosure, archive actions and removal feedback.
- Improve remote file saves and add completed MP4 playback.

## [0.3.0]

- Prepare JSTorrent production identity and retained updater trust candidates.
- Restore original branding and best-effort desktop/Android legacy migration.
- Qualification candidate only; production publication is a separate operation.


## [0.1.4] - 2026-09-26

- Add durable seeding goals, add-time file selection, and live DHT/PEX controls
  to the first-party application experience.
- Prepare the shared desktop interface for localization with a checked English
  catalog and native fallback; no translated locale ships in this release.
- Add bounded completed-file direct-save support to the owner remote-access
  preview while retaining its explicit incubation status.
- Add previewed local support diagnostics with exact copy/download, public
  issue links and privacy/recovery guidance. No logs, paths, torrent data,
  installation identifiers or automatic submission enter the report.

- Repair Windows startup when resetting a recognized older incubation catalog,
  and run native session recovery tests on every desktop platform.
- Verify complete download/restart/seeding/corruption-repair lifecycles and
  schedule broader storage recovery and owned Android SAF runtime coverage.
- Repair completed oversized-file seed admission, paused recheck Resume
  queue admission, and Android phone file-selection confirmation layout.
- Update compatible dependency fixes, generate desktop dependency notices,
  and gate package contents and expiring advisory review before release.

- Add a resettable pseudonymous installation identifier and exact local
  addition, download-completion, and foreground-session counters. Desktop and
  Android disclose the behavior, provide durable disable/reset controls, and
  preview every feedback URL field before external navigation.
- Migrate a valid desktop updater identifier into the single product-state
  owner and add a bounded extension-local uninstall survey summary. No
  continuous analytics, torrent/peer/path data, or telemetry SDK is added.
- Keep new identifier, age, and aggregate-counter query fields disabled until
  the corrected hosted privacy, feedback, and uninstall pages are deployed
  and publicly verified.

## [0.1.3] - 2026-08-30

- Add the owner-only remote-access preview for desktop, including Settings
  enrollment, durable browser resume, authorized-session administration, and
  a security audit log. The hosted controller and opaque relay cannot read
  authenticated application traffic.
- Keep remote access an unsupported, unadvertised incubation capability for
  manual owner testing. It controls a running desktop product host and does
  not provide Android remote control.
- Write torrent content directly to final paths, adopt existing payload
  through a bounded full recheck, and preserve unrelated files during
  recovery.
- Add responsive Library media details and playback, restore torrent sizes,
  and make High file priority durable.
- Improve metadata startup and dry-swarm recovery while bounding peer
  attempts, probe pacing, and retained transfer accounting.
- Reduce browser connection bandwidth with view-aware coalescing, sparse row
  patches, compact preparation progress, and incremental speed history.
- Replace settings mutation with revisioned typed patches so desktop, web,
  and Android drafts converge on authoritative state.
- Clarify that every `0.1.x` package is an unsupported incubation build. Its
  application-owned state and application contracts may be reset or replaced;
  no compatibility baseline begins until a future version is explicitly
  declared the first supported beta or release.
- Start a fresh schema-21 session catalog, resetting recognized schemas 1
  through 20 without touching user payload, and remove old DHT, desktop-shell,
  and browser-appearance compatibility readers.

## [0.1.2] - 2026-08-26

- Repair fresh-profile Windows listener selection and add the packaged native
  download-root picker.
- Register installed desktop packages for bounded `magnet:` and local
  `.torrent` activation, restore the existing window, and reuse the ordinary
  download-root and Add-options workflow without exposing source paths to the
  webview contract.
- Reject non-regular external `.torrent` paths before opening them and retain
  platform-native file URL handling across Windows, macOS, and Linux.
- Enforce one desktop product lifetime with default-on close-to-tray,
  persisted **Run in Background**, visible manual update checks, and joined
  close/Quit/restart shutdown.
- Add branded desktop tray/window integration and suppress the unwanted
  console window from release Windows launches.
- Add native completion and repair-attention notifications plus default-on
  active-download sleep inhibition with joined cleanup.
- Package the bounded RSTorrent native-messaging bootstrap, authorize the
  production JSTorrent and provisional JSTorrent Beta extension origins, and
  repair per-user Chrome registration on desktop launch.
- Extend credential-free desktop presubmit packaging to native Linux arm64
  while retaining the Linux x86_64 package gate.

## [0.1.1] - 2026-08-23

- Updater-validation release with no engine, protocol, or persistence changes.
- Reused the `0.1.0` application identity, updater trust root, production
  route, and application state as updater-validation evidence, without making
  that incubation state a supported compatibility baseline.

## [0.1.0] - 2026-08-23

- First signed incubation desktop packages for macOS, Windows, and Linux.
- First-party Rust BitTorrent engine embedded directly in the desktop app.
- Shared React Library, Transfers, and Workbench product interface.
- Explicit, signed in-app updates for supported self-replacing packages.
