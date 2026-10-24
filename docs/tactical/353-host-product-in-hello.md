# Tactical 353: Host Product Facts In The API Hello

Status: Complete, 2026-10-14. The [343](343-about-support-and-remote-updates.md)
plan's Slice 2, as narrowed by maintainer direction; commit authorized.
Topics: `application-view-api`, `web-ui-design`, `client-surfaces`.

## Scope And Stopping Condition

Tactical [347](347-about-on-every-web-host.md) put About on every web host,
but a remote session or Crostini page could not show its host's version.

**Why the hello.** The maintainer asked whether this should be a dedicated
API call. Every connection already starts with the hello:
- HTTP `GET /api/v1/hello`;
- the WebSocket `connected` frame;
- the Tauri `application_view_hello` command;
- the remote relay, which forwards the gateway hello.

All of them come from `ApplicationService::api_hello()`, and HTTP checks
credentials first. Facts that are fixed for the life of the host process
therefore belong in the hello. The client's one-time read was the real gap:
after a host restarts with a new version, a page that only reconnects kept
the old hello. That would also leave stale capabilities. So this slice does
two things:

- **Host facts in the hello.** Add an optional `ApiHello.product`
  (`ApiProductInfo`) with these fields:
  - `kind`
  - `version`
  - `build_id`
  - `target`
  - `identifier`
  - `profile_id`
  - `profile_location`
- **Refresh after a reconnect.** The web client reads the hello again after
  every reconnect. If the capabilities changed, it re-syncs its views.

Stop when the following are true, and the Rust, web and Android checks pass:
- each product host reports the field: desktop, headless, the gateway (which
  covers Crostini) and Android;
- About shows it on every web host, remote access included;
- a reconnect refreshes it.

Non-goals:
- A separate host-info call, or live (changing) host state.
- Android Compose About. This is 343's Slice 7. Android's engine semantics
  and generated boundary ship here.
- A commit build ID for Android and Crostini release builds; see Deferred.
- Profile location in diagnostics.

## Design

- **Host owner.** `ApplicationConfig.product: Option<ProductIdentity>` holds
  `kind`, `version`, `build_id`, `target` and `identifier`. The service adds
  the profile ID and its durable profile root when it builds the hello, so
  hosts cannot report a profile other than the one they opened. An ephemeral
  profile has no location.
- **One build-ID rule.** `rstorrent_session::source_build_id()` returns
  `option_env!("RSTORRENT_BUILD_ID")`, or `development` when unset.
  `ProductIdentity::for_this_build` fills that in, plus a target triple
  derived from the OS and architecture. Desktop overrides the target with
  Tauri's exact triple.
- **What each host reports:**

| Host | kind | version | identifier |
| --- | --- | --- | --- |
| Desktop | `desktop` | Tauri crate version | Tauri config identifier |
| Headless | `headless` | Release `VERSION` | none |
| Gateway, `--chromeos-crostini` | `crostini` | gateway crate version | none |
| Other gateway | `gateway` | gateway crate version | none |
| Android | `android` | `versionName` | `packageName` |

  The gateway's runtime `--build-id`/`RSTORRENT_BUILD_ID` overrides the
  compiled build ID, as its hosted assets already do. The headless release
  workflow now sets `RSTORRENT_BUILD_ID` to the source commit, as desktop
  does.
- **Android boundary.** `AndroidApplicationConfig` gains
  `application_id: String`. Rust rejects an ID that is empty, longer than 128
  bytes, or contains characters other than ASCII letters, digits, `.` and
  `_`.
- **Client validation.** Every `product` string is bounded:
  - `kind`: 16 bytes
  - `version`: 64 bytes
  - `build_id`: 160 bytes
  - `target`: 64 bytes
  - `identifier`: 128 bytes
  - `profile_id`: 128 bytes
  - `profile_location`: 4096 bytes

  A host that exceeds these bounds is a contract failure. An older host
  that omits `product` is accepted, and About shows "Not reported".
- **Refresh.** `LiveApplication` marks its hello stale on any `retrying`
  status. On the next `connected` status after the first attach, it reads
  the hello again:
  - WebSocket clients replace their cached hello on each `connected` frame.
  - HTTP and Tauri fetch it fresh.

  A failed refresh logs a warning and retries on the next reconnect.
- **Presentation.**
  - `SessionSummary.host` carries the facts.
  - `withHostProduct` overlays them on the page's own About facts. When the
    host reports an identifier, it replaces the desktop `getIdentifier()`
    lookup from Tactical 347, which this slice removes.
  - About shows the target and a **Library folder** row.
  - Diagnostics take the target from the host when there is no updater. They
    allow the Android targets and still never include the profile location.

## Validation

- **Rust:** a session test opens the service with and without a product.
  It asserts the hello fields, the profile ID, the durable location and the
  build ID.
- **Web:**
  - Hello validation accepts the field with or without its optional
    members, and rejects an oversized version or a missing profile ID.
  - A `LiveApplication` test checks the host facts on the session, then
    expires the view set and asserts that a second hello delivers the new
    version.
  - About and diagnostics tests cover a remote session showing the host's
    version, build, target, preview profile and library folder.
  - Diagnostics carry the host's facts but not its path.
- **Android:** the debug build regenerates the Kotlin bindings and compiles
  the new constructor argument.

## Evidence

- **Rust:** `cargo fmt --all -- --check`, `cargo clippy --workspace
  --all-targets -- -D warnings`, and `cargo test --workspace` (1646 passed).
  - Clippy flagged the larger `ApplicationServerFrame::Connected`, so its
    hello is boxed. The wire format is unchanged.
- **Web:**
  - Typecheck and localization check pass.
  - Unit suite: 650 passed, 2 skipped.
  - Playwright `support-diagnostics.spec.ts`: 22 passed, run against a
    private dev server on port 4191.
- **Android:** `clients/android/build.sh debug` regenerates the bindings,
  builds the APK and passes `testDebugUnitTest`.

## Deferred

- **Android and Crostini commit build IDs.** Their release builds still
  report `development` (Android) or the runtime-configured value (Crostini)
  until their pipelines set `RSTORRENT_BUILD_ID`. Crostini is frozen legacy.
- **Not exercised end to end:** a packaged desktop or on-device Android
  hello. The service, validation and client refresh paths are unit-tested.
