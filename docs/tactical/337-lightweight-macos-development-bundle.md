# Tactical 337: Lightweight macOS Development Bundle

Status: Complete locally, 2026-10-13.
Topics: `client-surfaces`, `application-connection-architecture`,
`capability-readiness`.

## Outcome And Stopping Condition

Add `./scripts/desktop-bundle` as a separate lightweight macOS development
launcher. Build the ordinary debug client and native helper, assemble an app
bundle with matching identity/icon metadata, and run its inner executable in
the foreground. Native registration can then select the bundle for later
extension launches. Keep `./scripts/desktop` unchanged. Stop after command
help/build, bundle identity/signature, real registration and production-ID
extension launch/reconnect/Quit/manual-start checks pass.

Non-goals: changing the native registration contract, production app/library,
installer or release packaging, signing trust roots, protocol/application
types, OS file/magnet associations, Android behavior or publication. This is
macOS developer tooling, not a new release flavor or engine tactical.

## Source Review And Invariants

Read the client/development guides, focused topics, Tactical 336,
`scripts/desktop`, `prepare-native-host.mjs`, desktop Tauri configuration/build
and native registration/control. `desktop` currently runs a raw Cargo binary;
macOS `launch_config` requires an `.app` ancestor before writing Chrome host
manifests. Existing MacApp launch requests use LaunchServices while the shell
can execute the bundle's inner binary directly to retain terminal ownership.

Use the ordinary development identifier/profile and honor a bounded JSON
`TAURI_CONFIG` override for isolated verification. Refuse production identity,
unsafe bundle names and rebuilding a running development bundle. Metadata must
match the compiled Tauri configuration. Keep artifacts in Cargo's target tree;
never replace the installed shipping app. Build-only must not launch or change
browser registration. Running the app uses its ordinary registration repair,
so Chrome's shared native-host route points to that development bundle until
another desktop installation repairs it. Document that consequence.

## Ownership, Bounds And Validation

The shell owns build preparation and then execs the foreground client; Ctrl+C
and native Quit retain normal termination behavior. The app owns its existing
engine, tray, library and bootstrap/control tasks. Bundle assembly owns one
temporary sibling staging directory and cleans it on success/failure. No new
runtime listener, owner, IPC boundary or dependency is introduced. Scripted
build output is bounded and the native helper keeps its existing resource and
origin/authentication bounds. Android and generated client boundaries are
unchanged/inapplicable.

Validate shell/Node syntax and help, actual debug build, plist metadata and
ad-hoc signature, running-bundle rebuild refusal, foreground registration and
real cold/warm production-ID extension lifecycle through the existing headed
runner and Machine Control. Use an isolated short test identifier/profile,
preserve inherited registrations/apps/grants and reap owned processes. Retain
the ordinary built bundle for the user; remove temporary validation artifacts.

## Execution And Evidence

Added the shell launcher and a dependency-free Node assembly script. Cargo
metadata/compiler artifacts select the actual target directory and executables.
Assembly validates the configuration and Mach-O inputs, writes matching plist
metadata, copies the helper/icon, and verifies the local ad-hoc signature before
replacing a previously owned bundle. An ownership marker bounds replacement to
this checkout; staging is cleaned on failure. Production identity, unsafe names
and running development clients are refused. The raw launcher is unchanged.

Validation on macOS:

- `bash -n scripts/desktop-bundle`, `shellcheck -x scripts/desktop-bundle`,
  `node --check scripts/build-desktop-bundle.mjs`, launcher help and
  `git diff --check` passed. Unexpected build-only arguments exit 2.
- Negative configuration probes refused the production identifier, a traversing
  product name and an array-valued `TAURI_CONFIG`.
- `./scripts/desktop-bundle --build-only` completed the actual web/CSP and Cargo
  debug builds, plist validation and strict/deep signature verification. Plist
  identity/name/version match the base configuration; both binaries are
  executable and no file/magnet associations are present. Build-only preserved
  inherited Chrome/Chromium registrations byte-for-byte.
- An isolated `TAURI_CONFIG` with identifier `com.jstorrent.check` and product
  name `JSTorrent Extension Check` built successfully. Foreground launch with
  `-- --extension-background` registered the generated app, and a production
  origin attach returned ready. Rebuilding while running was refused without
  modifying the executable. Ctrl+C stopped it; passive attach then reported
  control unavailable.
- `scripts/verify-production-desktop-extension.mjs` passed all nine checks
  against that generated bundle and unpacked production extension 1.1.4 in
  Chrome for Testing: passive stopped attach, authenticated cold launch, twelve
  singleton starts, native window opening, reload, tab reopen, graceful Quit,
  35 seconds remaining stopped, and explicit Start on the same empty profile.
  Machine Control provided native window/Quit evidence. The captured connected
  empty-library UI was visually inspected.
- `cargo fmt --all -- --check` passed. No Rust or application contract changed;
  the actual build and integration runner provide the proportional behavior
  checks for this developer-tooling slice.

macOS displayed local-network permission for the isolated test app. The likely
trigger is fresh-profile UPnP router discovery: desktop defaults select a local
listener and UPnP, whose discovery sends SSDP multicast even with no torrents.
This is inferred from the default settings and discovery path, not a traced
permission syscall. The extension lifecycle passed without granting permission;
the test prompt was declined during cleanup. Bundle purpose text now mentions
router discovery as well as local peers. Ad-hoc development signatures do not
provide the same stable privacy identity as shipping signatures; see
[Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).
No networking defaults or permission policy changed.

Subsequent [Tactical 338](338-macos-network-consent-research.md) experiments
confirmed that the multicast route-selection probe can request local-network
access even with UPnP disabled. That evidence supersedes the initial UPnP-only
inference above.

The runner's browser and isolated app were reaped. Inherited host registrations
were restored byte-for-byte; the isolated profile, test bundle, captures and
temporary runner files were removed. The owned Machine Control claim was
released while preserving the inherited operator grant. The ordinary preview
bundle was rebuilt with final metadata and retained for the maintainer. The
installed shipping app, user library and primary browser were not operated by
this qualification. Signed delivery and Android are outside this tooling slice.
