# Tactical 347: About On Every Web Host

Status: Complete, 2026-10-14. First slice of the
[343](343-about-support-and-remote-updates.md) plan (its Slice 3, client
side only); maintainer-directed, commit authorized.
Topics: `web-ui-design`, `client-surfaces`, `product-state-and-feedback`.

## Scope And Stopping Condition

Settings showed **About & updates** only when the host injected a desktop or
headless updater. On the following surfaces there was no version, no support
link and no diagnostics:

- a browser on remote access;
- the companion pages connected to the Android or desktop app;
- the legacy Crostini package and other gateway-served pages without an
  updater;
- the demo.

This slice makes the tab universal, using only facts the client already has.

- **The tab.** Settings always has an **About** category, last in the list.
  It is titled **About & updates** when an updater exists, and the Updates
  group appears only then.
- **Application group:**
  - how the page is connected: this computer, server, remote access,
    JSTorrent on Android, JSTorrent on this computer, or demo;
  - version, or "Not reported";
  - build;
  - target and package, only with an updater;
  - **This page**, for the remote client's own build.
- **Profile group** (desktop): build type (production, preview or
  development) and the app ID, read with Tauri `getIdentifier()`. Preview and
  development builds note that they keep a separate library.
- **Support group:** links and diagnostics on every host.

Stop when every bootstrap supplies its facts, diagnostics no longer require
an updater, and the web, Playwright support and Android crate checks pass.

Non-goals:

- Reporting host version, commit or profile over the API contract. That is
  343's Slice 2, which a remote session needs before it can show its host's
  version.
- Android Compose About (Slice 7).
- Remote update, reset and quit.
- Profile ID and location display.
- New network requests.

## Data Sources

| Host | Connection | Facts |
| --- | --- | --- |
| Tauri desktop | `desktop` | Updater info, plus the identifier from `getIdentifier()` |
| Headless | `server` | Updater info |
| Crostini, gateway, `scripts/webui` | `server` | Crostini's `/healthz` `build_id` when present |
| Remote access | `remote` | `VITE_RSTORRENT_REMOTE_BUILD_ID` as **This page** |
| Android companion | `android-companion` | `hello.backend.product_version`, only if it is version-shaped |
| Desktop companion | `desktop-companion` | `hello.backend.product_version`, at most 64 characters |
| Demo | `demo` | Supplied by `App` when no facts are given |

**Android companion version fix.** The Android companion reported
`CARGO_PKG_VERSION` (`0.1.0`) as `product_version`. It now reports the app's
`versionName`, which Kotlin already passes in `AndroidApplicationConfig`.
Pairing identity compares only kind, instance and profile, so existing
pairings are unaffected.

## Diagnostics Schema 2

- **Input.** `buildDiagnostics` takes `SupportFacts` (the about facts plus an
  optional updater snapshot) instead of a `DesktopUpdaterSnapshot`.
- **New fields:**
  - `connection`;
  - `identity` and `flavor`;
  - `page_build`, only when the page has its own build.
- **Updater fields.** `update_check_privacy`, `updater_phase` and
  `updater_operation` appear only with an updater. `waiting-for-stable` is
  now an allowed phase.
- **Build pattern.** Also accepts headless's version-shaped build ID and
  `local-webui`, which previously became `unknown`.
- **Unchanged rules.** Every field is still allowlisted or bounded by a
  pattern, the report stays at most 2 KiB, and it never carries paths, logs,
  torrent data, peers or credentials.

## Validation

- Diagnostics unit tests:
  - the desktop report with identity;
  - remote, companion and Crostini reports without an updater;
  - the headless build ID;
  - flavor mapping;
  - hostile and oversized values, including an unknown `profilePath`
    property.
- Component tests for each host shape:
  - remote (no Updates group, "Not reported", This page);
  - Android companion version;
  - development and production profiles;
  - the existing updater cases.
- An App test asserting the About tab exists without an updater.
- Companion bootstrap tests asserting the facts passed to the mount; Android
  rejects a malformed version.
- A demo-mode screenshot of the About tab.

## Evidence

- Web typecheck, localization check and unit suite: 575 passed, 2 skipped.
- Playwright `support-diagnostics.spec.ts`: 22 passed. It ran against a
  private dev server on port 4191 because another session held 4177.
- `cargo fmt --all -- --check`, `cargo clippy -p rstorrent-android -- -D
  warnings` and `cargo test -p rstorrent-android` (15 passed).
- The demo screenshot showed Application (Connected to Demo, Version Not
  reported) and Support diagnostics under **About**. Word values use the
  normal font; identifiers stay monospace.
- Not run: a packaged desktop build, so `getIdentifier()` was not exercised
  in a real Tauri window, and an on-device Android companion connection.
  Both paths are covered only by unit tests.
