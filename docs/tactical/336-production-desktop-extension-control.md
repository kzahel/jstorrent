# Tactical 336: Production Desktop Extension Control

Status: Complete locally, 2026-10-13. Corrected signed desktop delivery remains
separate and is not authorized by this tactical.
Topics: `application-connection-architecture`, `desktop-jstorrent-replacement`,
`product-surfaces-and-migration`, `capability-readiness`.

## Outcome And Stopping Condition

Repair the production Chrome extension's desktop start/attach admission and
verify an unpacked production-ID extension against a real macOS desktop owner
using Machine Control. Stop after exact-origin, authentication, singleton,
native-window, detach/reconnect and stopped/manual-start checks pass and local
validation and cleanup are recorded. No publication, signing-root change,
engine behavior, personal torrent mutation, Android presentation, new listener
or protocol version is in scope.

## Diagnosis And Source Review

Installed desktop 0.3.0 replies `unsupported_operation` to `attach_control` from
the production ID while accepting the beta ID. Chrome has production extension
1.1.4. Both 0.3.0 and 0.3.1 source retain the beta-only dispatch guard in
`crates/rstorrent-native-host/src/lib.rs::dispatch`; host registration already
permits both IDs. `desktopBootstrapFailure` maps the refusal to compatibility
guidance. `application_websocket::upgrade_application_connection` already
uses the exact beta/production allowlist for desktop bearer admission.

Tacticals 232, 234 and 236 own the accepted intent/recovery contract. Read
native host dispatch/control tests, registration, extension worker/popup,
desktop companion validation and gateway desktop-control tests. This is a
platform admission repair, not engine work; no libtorrent oracle or generated
Android boundary changes apply. Android pairing/admission remains unchanged.

## Invariants, Ownership And Bounds

Only the two exact reviewed extension origins can start/attach. Prefixes,
suffixes, arbitrary IDs and malformed origins confer no control authority.
Attach remains passive; only explicit toolbar/Start intent starts the desktop.
Native window launch remains separate. The desktop owns its engine/library,
bootstrap socket and authenticated control listener. Browser pages own bounded
views and connection cleanup; the native helper owns only framed bootstrap.
Existing frame limits, four connection slots, credentials, same-user checks,
cancellation and joined shutdown remain unchanged. Runtime adapters depend
inward on application state; no protocol/domain layer changes are needed.

## Validation And Evidence

Required: native dispatch accepts production/beta start/attach with correct
intent; lookalikes fail before launcher use; real process attach reaches the
stopped runtime path; gateway tests authenticate both IDs and refuse foreign
origins and invalid credentials. macOS evidence loads the unpacked production
extension, verifies cold/warm launch, one owner/library, native window open,
detach/reconnect, and explicit restart after Quit without passive resurrection.
Use a separate test browser/profile where practical. Preserve inherited apps,
data, native-host registrations and Machine Control grants; release the owned
claim and reap test processes. Record any production-installation changes
explicitly. No store or signed-release claim follows from local evidence.

## Execution Results

The native helper now admits only the exact production and beta origins for
start/attach. Its dispatch regression covers both intents and refuses arbitrary
IDs, prefix/suffix lookalikes, omitted slash and additional path before launcher
use. Real helper processes reach the stopped attach path for both approved IDs
without consulting a launch configuration or creating files. The gateway's
existing bounded admission test now authenticates both IDs, opens their views
on one service, rejects a wrong credential/foreign Origin/Host, fills exactly
four connection slots and joins shutdown to zero active connections.

Commands run after sourcing `scripts/dev-env.sh` for toolchain work:

```sh
cargo test -p rstorrent-native-host
cargo test -p rstorrent-gateway desktop_control --lib
cargo fmt --all -- --check
cargo clippy -p rstorrent-native-host -p rstorrent-gateway --all-targets -- -D warnings
npm run typecheck --prefix clients/web
npm run test --prefix clients/web
npm run test --prefix clients/extension
npm run package:jstorrent --prefix clients/extension
npm run build --prefix clients/web
TAURI_CONFIG='{"identifier":"com.jstorrent.check","productName":"JSTorrent Extension Check"}' \
  cargo build -p rstorrent-desktop -p rstorrent-native-host
node --check scripts/verify-production-desktop-extension.mjs
git diff --check
```

All pass: 21 native unit and four real-process cases, three desktop gateway
cases, full web typecheck/unit suite, 60 extension cases, companion/CSP and
desktop builds, and focused all-target clippy. A concurrent gateway edit first
failed compilation using an obsolete command field; the owning work corrected
it before the passing gateway run. No unrelated implementation was changed by
this tactical. Broad workspace validation is not claimed for this slice.

The public Machine Control macOS host guide and common CLI are used with an
owned exclusive claim and an inherited approved observe/control/browser/devtools
grant. A temporary registry selects the built-in local host because the private
inventory's registry excludes it; no private inventory is changed. A separate
headed Playwright Chrome for Testing loads the extracted production ZIP with
the actual production ID. The primary browser receives no temporary profile
or replacement extension. The native candidate is a separate locally built
bundle and `com.jstorrent.check` profile, with no torrent additions or personal
data access. Machine Control verifies the native window and gracefully quits
only that candidate.

Nine real-product checks pass: production identity/passive stopped attach,
cold background launch and authenticated empty library, twelve simultaneous
starts on one runtime, explicit native window, page reload, tab close/reopen,
native Quit, 35 seconds stopped through passive reconnect, and explicit Start
with fresh runtime identity on the same profile. The connected library capture
is visually inspected. A final rerun includes strict Machine Control window
inventory/bundle identity assertions and cleanup failure reporting.

Exact tested SHA-256 bindings:

| Artifact | SHA-256 |
| --- | --- |
| Isolated desktop binary | `5722a0286084ffe654331c6ddbffcee09fbc109c4dc4829dbff55a54b2ba2a2e` |
| Native helper | `1dc6cb501651e34baeb36637c19236807fd5be352cd86151daac7ce821f79ae6` |
| Production extension 1.1.4 ZIP | `d1fbd7586b27757c8b17cd8f39eb555d60246961a4665e4b49f6816396b32736` |

The first candidate used a longer isolated identifier and hit macOS's existing
filesystem Unix-socket path limit during bootstrap. Shortening the test ID
resolves the rehearsal; long profile paths remain a separate known platform
constraint. A process fixture initially lacked the required private directory
mode; setting 0700 exercises stopped attachment rather than security refusal.
The runner also waits for bootstrap dismissal before inspecting mounted React,
because the initially empty HTML `main` can be visible before connection.
The test client's macOS local-network prompt is declined through Machine
Control; all launch/control checks still pass without LAN permission.

The runner terminates its candidate and reaps its browser. Inherited native-host
manifests are restored byte for byte; extra test-browser manifests, isolated
profiles/bundle, temporary reports/captures and task-created crash reports are
removed. The inherited Machine Control grant is retained and the owned claim
is released. The signed installed 0.3.0 app and personal library remain intact.
Signed delivery, Windows/Linux production-ID installed qualification and live
torrent transfer are not claimed. Existing Android semantics and generated
application boundaries are unchanged.
