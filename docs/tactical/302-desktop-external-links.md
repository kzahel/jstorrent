# Desktop External Links

Status: Complete locally; installed update/deployment remains separate.

Topics: `web-ui-design`, `client-surfaces`, `localization`

## Scope And Stopping Condition

Repair the support and release links that silently do nothing in the macOS
desktop webview. Stop with shared external-link presentation, the official
Tauri opener plugin, scoped URL permissions, failure feedback, web/Rust checks
and native macOS IPC/browser-handoff evidence, then commit and push the slice.

## Dependencies And References

Read the client, web design, application view and localization topics and
Tactical216's support implementation. The official Tauri opener documentation
and exact `tauri-plugin-opener`2.5.3 source (`src/lib.rs`, `commands.rs`,
`scope.rs`, `scope_entry.rs`, `open.rs`) own plugin initialization, permissions
and system opening behavior. This MIT OR Apache-2.0 plugin is compatible with
the existing Tauri2.11 graph; newer2.6/2.7 require a Tauri upgrade outside scope.
Use version-matched JavaScript bindings. No upstream implementation is copied.

## Invariants, Ownership And Non-Goals

- Shared links remain semantic anchors. Browser navigation remains native.
- Desktop bootstrap injects one `OpenExternalUrl` function through a provider;
  presentation code imports no native APIs. Each link owns bounded pending and
  generic localized failure feedback, without exposing raw plugin errors.
- Disable the plugin's automatic anchor interception to avoid duplicate opens
  and competing handling. Enable only `open_url` to the specific support URLs,
  release index and release-tag paths. No file/program-opening permissions.
- Engine, application API, media authority, Android/iOS native presentation,
  profile migration, packaging/signing, updates and deployment are unchanged.
  Android/iOS do not render this desktop/browser React About surface.
- No background task is added. Browser/native test processes and temporary
  fixtures belong to the test runner and must be reaped/removed.

## Validation

Component tests cover desktop click/keyboard/modified activation, rejection,
retry and browser anchor behavior; adapter tests exercise the actual plugin
binding IPC. Browser tests click the real support/release controls with injected
desktop opener and normal browser navigation. Native macOS evidence exercises
the actual plugin through a real WKWebView and generated capability scope,
including allowed and rejected URLs. Run web typecheck, full tests, localization,
production build and focused Playwright plus proportional Rust fmt/clippy/tests.
Record exact outcomes and limits below before committing.

## Evidence

The shared `ExternalLink` handles the three support links, manual release
index and signed-release link. Desktop bootstrap supplies the version-matched
Opener binding through `ExternalUrlProvider`; browsers retain ordinary anchors.
A per-link pending fence prevents duplicate activation until opening finishes.
Failure gives one generic English retry message without raw errors. Native
plugin auto-interception is disabled, with no file or chosen-program permission.
Only the opener and its three transitive packages are added to the Rust lock;
existing Tauri versions remain unchanged. Third-party notices record licenses.

Validation on macOS ARM64:

- `npm run typecheck --prefix clients/web`: pass.
- `npm run test --prefix clients/web`:491 pass, two existing skips. New cases
  cover actual plugin-binding IPC, support routing, browser semantics, Enter,
  modifier/middle clicks, duplicate activation, rejection and retry.
- `npm run check:localization --prefix clients/web`: pass across all catalogs.
- `npm run build --prefix clients/web`: pass;13 CSP-safe JavaScript bundles.
- `npm run test:e2e --prefix clients/web -- support-diagnostics.spec.ts`:
  22 pass. Controlled external destinations prove actual browser tabs and
  opener isolation; injected desktop routes prove all five controls, failure,
  retry and no webview navigation/popups. Existing diagnostics/accessibility
  phone/wide, light/dark and managed-package cases continue to pass.
- `cargo fmt --all -- --check`: pass.
- `cargo check -p rstorrent-desktop --locked`: pass after dependency resolution.
- `cargo clippy -p rstorrent-desktop --all-targets --locked -- -D warnings`:
  pass, including the native example.
- `cargo test -p rstorrent-desktop --locked`:61 pass; remaining native/doc targets
  have zero cases. No full workspace run is claimed for this shell/client fix.
- `cargo build -p rstorrent-desktop --example external_links_smoke --locked`
  and the resulting executable under a45-second subprocess deadline:14/14 pass.
  The independent real WKWebView uses the production-generated capability and
  actual opener plugin, with no engine/profile/migration/native registration.
  Five allowed destinations reach the default browser; eight out-of-scope or
  unsafe URLs and one explicitly chosen application are rejected.
- Native browser inventory independently confirms exactly five new Chrome tabs:
  the three support destinations, Latest resolving to desktop-v0.3.0 and a
  synthetic v0.3.0 tag (expected404; URL handoff succeeds). All five owned tabs
  are closed afterward; zero remain. No issue is submitted or report uploaded.

The opt-in `external_links_smoke` example is the repeatable native regression:
run it under an external timeout and close its five resulting browser tabs.
It has a separate application identifier and does not start product services.
Native Windows/Linux browser launching is not exercised here. The existing
installed JSTorrent application is not rebuilt/replaced by this source commit.
