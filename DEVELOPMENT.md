# JSTorrent Development

JSTorrent has a pure protocol core, a Tokio runtime, an application service,
maintained first-party desktop, Android, and iOS clients, and loopback
libtorrent interoperability harnesses. Product clients explicitly use online
tracker and peer networking while diagnostic tools retain loopback-only
policy. Public desktop 0.3.0 uses JSTorrent's established identity and signing
key. The RSTorrent release track is frozen; retained incubation build paths are
for isolated development and historical compatibility, not publication. See
the [release policy](docs/topics/product-surfaces-and-migration.md#jstorrent-only-release-policy-2026-10-11).

## Starting A Session

Read these in order:

1. [`README.md`](README.md)
2. [`docs/vision.md`](docs/vision.md)
3. [`docs/engineering-principles.md`](docs/engineering-principles.md)
4. [`docs/topics/product-direction.md`](docs/topics/product-direction.md)
5. [`docs/topics/capability-readiness.md`](docs/topics/capability-readiness.md)
6. [`docs/topics/beta-release-readiness.md`](docs/topics/beta-release-readiness.md)
7. [`docs/references.md`](docs/references.md)
8. The active document under [`docs/tactical/`](docs/tactical/README.md), once
   one exists

Before changing an established continuing concern, look for and read its topic
under `docs/topics/`.

## Cross-Platform Test Machines

Use the sibling `machine-control` checkout at `~/code/machine-control` for any
Windows, Linux, or macOS VM/appliance testing and physical ChromeOS control.
Start with its common `bin/machine-control` CLI and the applicable platform
guide; use a platform-specific passthrough only for a capability that the
common interface does not expose. Acquire and release any required target
claim, preserve inherited machine state, and follow the controller's lifecycle
and recovery policy. Private target selection may come from the maintainer's
dotfiles inventory, but target identities and credentials must not be copied
into this repository.

Boot a VM only when its next executable check is ready. Shut it down through
Machine Control between uses, including while waiting for builds, approvals or
other targets; do not leave idle VMs running for later checks. Verify the stopped
state and release the claim when the session no longer needs exclusive access.

On physical Chromebooks, close browser tabs individually before closing the
application windows after each test slice. Closing only the Chrome window can
leave the entire session available to restore on its next launch. Use fresh
Machine Control browser and native inventories, verify input focus before tab
shortcuts, and require the page count to decrease after each close. Treat the
common ChromeOS targets projection as page entries even when it omits `type`;
an absent field is not proof of an empty browser. Verify zero remaining pages
and native Close controls. When correcting accumulated sessions, independently
check that a fresh normal Chrome launch opens only a new tab, then close it too.
Preserve installed application data, grants and the appliance power policy.
Capture and report each slice separately under the ignored evidence path.

Do not substitute direct hypervisor commands or legacy platform-specific
testbed repositories for ordinary cross-platform acceptance. Direct provider
access is reserved for a recovery procedure explicitly documented by
machine-control.

## Standalone Foreground Downloader

Build and run the finite stateless downloader with:

```bash
source ~/.profile
cargo build --locked --release -p rstorrent-session --bin rstorrent-download
target/release/rstorrent-download --output /path/to/downloads \
  'magnet:?xt=urn:btih:...'
target/release/rstorrent-download --output /path/to/downloads file.torrent
```

Omit `--output` to use the current directory. The process composes one online
ephemeral `ApplicationService`, including its bounded in-memory session and
metrics SQLite databases, and shuts that owner down after verified completion.
It writes wanted bytes directly at final paths, selects all non-padding files
unless the magnet supplies BEP 53 `so`, creates no durable profile state, and
does not seed after exit. A later run rechecks payload rather than restoring a
resume database.

Exit `0` means verified selected completion; `2` is argument or local-source
classification failure; `3` is cooperative output-root lock contention; `4`
is rejected magnet/metainfo/application input; and `5` is terminal runtime,
network, storage, or engine failure. Ctrl-C exits `130`, and Unix `SIGTERM`
exits `143`, after joined cleanup. The root lock coordinates only same-user
`rstorrent-download` processes, so do not use the target concurrently from
another torrent client.

Run the controlled pinned-libtorrent lifecycle, selection, recheck, crash,
locking, permission, and artifact-cleanliness matrix with:

```bash
source ~/.profile
cargo build --locked --release -p rstorrent-session --bin rstorrent-download
uv run --project tests/interop --locked \
  python tests/interop/stateless_foreground_download.py
```

## Current Tactical State

Active release-hardening Tactical
[`212`](docs/tactical/212-application-lifecycle-verification-gate.md) adds a
bounded complete application gate to presubmit. Run its independently authored
single/multifile fixtures, source-offline restart and seeding, paused corruption
check, exact repair, keep-data removal and joined cleanup with:

```bash
source ~/.profile
cargo build --locked -p rstorrent-gateway
uv run --project tests/interop --locked \
  python tests/interop/application_lifecycle_smoke.py \
  --binary target/debug/rstorrent-gateway
```

Add `--extended` for the source-offline oversized single-file and one-entry
folder restart/seeding cases. The weekly `Verification matrix` workflow runs
this extended cohort and `unified_resume_recheck.py --phase all`, including
all three exact checkpoint crash boundaries. It retains bounded JSON for seven
days; public swarms and performance thresholds are outside this gate.


Optional `--output PATH` writes a bounded JSON report containing generated
payload hashes and scalar resource evidence, without paths or peer identifiers.
Each run owns and removes its temporary profile, payload and child processes.

Multiple independent tacticals may be active concurrently; this section is a
status summary, not a work-selection lock or required execution sequence.
User-directed work does not need to pause or displace another active tactical.

Current active release work includes
[`158-desktop-signed-packaging-and-updater.md`](docs/tactical/158-desktop-signed-packaging-and-updater.md),
whose remaining gates are clean signed Windows replacement/relaunch,
Windows firewall-consent characterization, and installed Linux x86_64
evidence, plus
[`194-chromeos-android-extension-control.md`](docs/tactical/194-chromeos-android-extension-control.md),
the first migration-critical JSTorrent Android parity slice. Tactical `194`
keeps the sole Rust application/engine/profile/SAF owner in the Android
foreground service and packages the shared React UI in the extension as an
explicitly paired same-device ChromeOS presentation. Its shared root action
opens Android's SAF picker, and retained grants keep prior torrents on their
original roots after a new root becomes current; implementation and physical
gates remain open. Completed Tactical `193` supplies the source-built finite
`rstorrent-download` command documented above, with controlled lifecycle and
native macOS/Linux/Windows gates. Completed Tactical `176` carries durable
High/Normal/Skip file priority through persistence, scheduling, and every
first-party client; its
final macOS-hosted iOS simulator/archive gate passes. Completed Tactical `186`
separates tiny latest-value current rates from interest-selected exact graph
history, replaces repeated complete graph windows with bounded
cursor-validated appends, and cuts the Tactical `185` residual server payload
by 41.98%.
Completed Tactical `185` replaces measured repeated Torrent, File, Peer, and
active-piece rows with closed typed semantic deltas across all first-party
reducers. Its clean retained run cuts another 36.77% from post-coalescing
server payload while keeping the contract transport-neutral for a much later
negotiated binary codec with an explicit field registry.
Completed Tactical `182` bounds preferred-uTP/TCP/MSE/plain handshake work to
one 15-second outbound-attempt lifetime and conservatively turns over a
zero-contribution metadata worker only when the 30-peer cohort is saturated
and another eligible candidate is waiting.
Completed Tactical `181` expands metadata acquisition from eight combined
dial/worker slots to a 30-peer cohort while spacing accepted attempts at a
configurable no-burst default of ten per second beneath unchanged fair and
session-global connection limits.
Completed Tactical `179` resets recognized schemas 1 through 20 and removes
compatibility-only DHT, desktop-shell, and browser-appearance readers while
preserving external payload. Completed Tactical `177` retains the
ordinary peer failure ceiling while adding exact tracker-source rehabilitation
and one slowly paced transient-failure content probe only after every ordinary
connection action is exhausted. Tactical `158` retains its signed-candidate
and installed-update gates unchanged.
Completed Tactical `180` replaces the unsupported whole-value and forced-pair
settings commands with closed typed patches and makes web/Android settings
drafts converge by durable receipt revision under complete live updates and
resets. Delivery-shape optimization remains separate measured work.
Completed Tactical `170` supplies the configured ordinary-user Linux headless
service: strict versioned root/listener/origin/auth configuration, one process
and profile owner, a disabled-by-default systemd user unit, rollback-safe
repair, preservation-safe uninstall, deterministic x86_64/ARM64 archives, and
real x86_64 detached-transfer/re-seeding evidence. Completed Tactical `171`
adds strict signed source release/update machinery, explicit CLI/browser
checks and CLI apply, exact credential-free RFC 1918 admission, and the enabled
healthy current-host x86_64 LAN deployment. Public channel promotion and
native ARM64 systemd/update evidence remain later work.
Completed Tactical `166` supplies the typed desktop compatibility/launch host,
per-user registration and sidecar packaging, and the self-contained Manifest
V3 JSTorrent Beta seed. Chrome 151 on an installed unsigned macOS arm64 app
proves its exact provisional store ID, native `hello` from a stopped state,
and cold desktop launch. Completed Tacticals `167`--`169` own the selected
Crostini topology; active Tactical `194` owns only the distinct Android
extension-control path.
Completed Tactical `162` supplies one packaged desktop instance,
close-to-tray policy, persisted background intent, joined Quit, release-only
Windows GUI subsystem validation, a native Linux arm64 package gate, and
installed Windows x86_64/Linux arm64 lifecycle evidence. Tactical `158` now
owns the next signed package and installed update repetition. Completed
Tactical `159` supplies
credential-free Rust/web, deterministic browser E2E, native desktop package,
Android dual-ABI, iOS simulator/archive, and short loopback-interoperability
presubmit signal.
Completed Tactical `160` repairs Windows fresh-profile local-network address
selection and adds a native Windows regression; Tactical `158` owns the first
signed package carrying both repairs and the installed update repetition.
Completed Tactical `161` adds the parented native Tauri picker, hosted
Windows/Linux package gates, and installed Windows cancel/select/repair/restart
evidence.
Completed Tactical `163` adds bounded installed `magnet:` and local
`.torrent` activation, one opaque FIFO intake owner, the existing Add workflow,
and actual macOS/Windows/Linux package assertions. Deterministic and Linux
arm64, Windows x86_64-application, macOS arm64 installed, and exact hosted
eight-job evidence pass. The Windows campaign ran the actual x86_64 NSIS/PE
under Windows 11 arm64 x64 emulation, while the macOS campaign preserved
JSTorrent as the inherited default handler and targeted the incubation bundle
through LaunchServices.
Completed Tactical `164` adds native desktop completion and fatal/repair
notifications. Completed Tactical `165` adds default-on desktop/Android
active-work sleep inhibition, removes Android's Wi-Fi lock, records the iOS
inapplicability boundary, and passes guest-native desktop plus attached-device
evidence. Tactical `158` owns their first signed candidate and the Windows
x86_64 behavior repeat.
Completed Tactical `157` established the release ledger, graduated the Android
client to `clients/android`, and added provisional packaging artwork. The
durable release backlog and platform gates live in
[`docs/topics/beta-release-readiness.md`](docs/topics/beta-release-readiness.md).
Decision-complete wired-LAN uTP Tactical `153` remains Later; completed
Tactical `156` closes the strict hybrid runtime slice. The chronological notes
below are retained as implementation history, not a competing current queue.

[`001-bounded-large-piece.md`](docs/tactical/001-bounded-large-piece.md) is
complete. It replaced the first slice's piece-sized allocation with a
budgeted 16 KiB block pipeline, unverified staging storage, and streamed
verification of a 32 MiB piece under a 256 KiB payload allowance.

[`000-first-verified-piece.md`](docs/tactical/000-first-verified-piece.md)
remains the completed execution record for the initial protocol/runtime
vertical slice.

[`002-selective-multi-file-storage.md`](docs/tactical/002-selective-multi-file-storage.md)
is complete. It established bounded multi-file parsing and mapping, selected
staging, compact skipped-file part slots, streamed mixed-source verification,
padding omission, durable reopen, and verified materialization.

[`003-android-storage-feasibility.md`](docs/tactical/003-android-storage-feasibility.md)
is complete on `jstorrent-tablet`, Chromebook ARCVM, a physical Pixel 7a, and
a physical Moto X4 using both internal and removable exFAT storage. It proved
fixed-buffer native file-descriptor operations, persisted SAF reopen,
descriptor ownership, cancellable termination, staging publication, and exact
cleanup. The exFAT result also showed that sparse-mode file growth may perform
full allocation and block on a destination that does not preserve holes.

[`004-android-engine-bootstrap.md`](docs/tactical/004-android-engine-bootstrap.md)
is complete. It packaged the actual engine behind UniFFI in a foreground
service and passed the edge-rich selective fixture, bounded lifecycle,
cancellation, failure, and cleanup matrix on the AVD, Chromebook ARCVM, and
Moto X4.

[`005-saf-selective-storage.md`](docs/tactical/005-saf-selective-storage.md)
is complete. It connected the selective engine to user-granted SAF documents
through synchronously duplicated descriptors, explicit native preparation and
provider publication phases, restart verification, and bounded cleanup.

[`006-magnet-metadata-peer-hint.md`](docs/tactical/006-magnet-metadata-peer-hint.md)
is complete. It added bounded v1 magnet parsing, direct peer-hint bootstrap,
and bidirectional BEP 9 metadata exchange.

[`007-durable-session-control.md`](docs/tactical/007-durable-session-control.md)
is complete. It established the SQLite-backed application service, semantic
commands, verified metadata retention, piece checkpoints, and conservative
restart.

[`008-reactive-multi-surface-control.md`](docs/tactical/008-reactive-multi-surface-control.md)
is complete. It added bounded recoverable reactive views and generated client
types, then proved the same controlled pause/resume download through Chrome
over authenticated WebSocket, Tauri over commands and Channels, and Android
Compose/UniFFI under foreground-service ownership.

[`009-android-saf-session-storage.md`](docs/tactical/009-android-saf-session-storage.md)
through
[`012-bounded-diagnostics-progress.md`](docs/tactical/012-bounded-diagnostics-progress.md)
are complete. They connected Android to durable SAF session storage, added
bounded peer and one-shot UDP tracker lifecycles, and established equivalent
typed progress and diagnostics on the shared web and Compose surfaces.

[`013-explicit-live-network-policy.md`](docs/tactical/013-explicit-live-network-policy.md)
is complete. It gives every runtime an explicit offline, loopback-only, or
online outbound policy, selects online networking for desktop and Android,
and replaces the former whole-download timeout with bounded network-operation
deadlines.

[`014-scheduled-udp-tracker-lifecycle.md`](docs/tactical/014-scheduled-udp-tracker-lifecycle.md)
is complete. It replaces one-shot tracker exhaustion with supervised
per-torrent UDP scheduling, multi-tracker fallback and promotion, bounded
retransmission and connection-token reuse, automatic reannounce, and
equivalent waiting/retry diagnostics in the web and Android clients.

Tactical `016` completed the bounded session-owned IPv4 DHT foundation with
private-torrent gating and useful warm restart. Tactical `017` completed the
bounded multi-peer connection/request owner, parallel metadata acquisition,
late discovery, expiry, replacement, failover, and ordinary multi-piece
single-file execution. Endgame and integrity recovery are the next reliability
slice; Tactical `015` remains the independent paired live-comparison work. See
[`docs/topics/capability-readiness.md`](docs/topics/capability-readiness.md),
[`docs/topics/peer-lifecycle.md`](docs/topics/peer-lifecycle.md), and
[`docs/topics/download-correctness.md`](docs/topics/download-correctness.md).

Tactical `033` completed the leased view-set, generated contract, polling
client, and headless application boundary. Tactical `034` completed the fresh
responsive React/Zustand/CSS Modules inspection surface, virtual torrent and
peer grids, and permanent deterministic named demo adapter. Tactical `035`
completed stable Rust torrent and active-peer projections, the semantic live
adapter, independently reaped view sets, and suspended-client recovery; see
[`docs/topics/web-ui-design.md`](docs/topics/web-ui-design.md). Tactical `041`
adds the complete selected-torrent Files projection, independent Done and
Verified progress, configurable virtual columns, and a 4,096-row scale
scenario through the same headless surface.

Run the controlled production-web peer inspection proof without launching a
visible browser or Tauri window with:

```bash
source ~/.profile
uv run --project tests/interop --locked \
  python tests/interop/browser_peer_inspection_surface.py
```

Pass `--screenshot-dir target/headless-evidence/t041-live-files` to retain
loopback-only peer and Files wide, compact, phone, and reconnecting captures.
The harness creates and removes temporary application, browser, seed, and
download state, uses the pinned Python libtorrent environment, verifies
payload SHA-1, and requires every child process to join.

Run the durable client-settings restart and incoming-seeding proof with:

```bash
source ~/.profile
uv run --project tests/interop --locked \
  python tests/interop/client_settings_restart.py
```

This loopback-only harness drives the production web build and ordinary
authenticated gateway through four application generations. It applies and
persists a nondefault listener/connection/slot group, keeps one pinned
libtorrent download active and hash-verifies it across a live listener
handover, recovers a real fixed-port bind conflict in the same application
generation through the normal command path, and asserts bounded high-water and
zero-owner shutdown observations.

Run the exact seed-admission and durable-goal oracle with:

```bash
source ~/.profile
uv run --project tests/interop --locked \
  python tests/interop/seed_admission.py
```

The loopback-only harness creates six deterministic 4,096-byte torrents and
six controlled UDP trackers, then drives pinned libtorrent 2.0.13.0 leechers.
It proves active-seed limits one and two, exact tracker events and counts,
threshold-induced reorder, goal-met continuation, payload hashes, restart-
equivalent admission, bounded resources, joined shutdown, and cleanup.

Add `--disk-pressure` to run the isolated Tactical `044` storage proof. It
uses only loopback traffic, injects a bounded slow-write profile into the
unauthenticated development gateway, verifies high/low pressure recovery and
exact output, and can retain Disk screenshots through the same
`--screenshot-dir` option.

Add `--piece-map` to run the isolated Tactical `045` Pieces proof. A bounded
loopback seed drives a 17-piece transfer through active work, deliberate
view-set lease expiry, fresh-snapshot recovery, exact verified completion, and
external payload comparison. The option can retain active and complete Canvas
screenshots without launching a visible client.

## Toolchain

On the maintainer's configured development machines, load installed Rust,
Android, Java, and related toolchains with:

```bash
source ~/.profile
```

Once a Rust workspace exists, the expected default validation baseline is:

```bash
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
```

The `Fast CI` workflow gives early PR feedback on the exact submitted head.
It lints changed portable Rust crates and their portable dependents, runs
formatting and the directly changed libraries' unit tests, and checks
generated-contract drift in parallel when the gateway is affected. Web type/unit/
build, companion packaging and website build checks run for their affected
surfaces. Workflow/reviewer safety checks always run. Unknown executable or
shared configuration changes select conservative checks; docs-only changes
skip product builds. The stable aggregate check is **Fast PR feedback**.

The warm-run target is 3--5 minutes, not a qualified duration or timeout.
Cold dependencies and broad changes may take longer. Fast checks retain the
ordinary optimized Rust profiles. They restore the ordinary CI dependency
and contract caches using the same shared keys, without saving; full CI remains
their owner.
Fast checks omit dependents' runtime tests, Rust integration and feature-variant
execution, browser E2E, native packaging and mobile builds.
The existing `CI` workflow remains independent full qualification, with its
original job names and coverage. Branch protection is unchanged.

Full qualification runs shared-web validation, companion-extension packaging,
and workflow/release-tool checks in independent jobs. A failed extension package
does not suppress web contract drift, type, unit, production-build, or browser
coverage. Native desktop, Android, and iOS jobs retain their separate gates.

The optional custom agent PR review lane follows
[`docs/topics/agent-pr-review.md`](docs/topics/agent-pr-review.md). It uses a
separate isolated checkout, restores trusted main build caches, and publishes
commit-bound findings after successful Fast CI PR checks. Failed/cancelled
fast runs cannot start automatic review; full qualification may still be
running. Explicit manual reviews remain available. Automatic activation is
still disabled while the new lane and build cache are being qualified.

Run the bounded build-profile comparison with four Cargo jobs:

```bash
source ~/.profile
node .github/scripts/benchmark-fast-ci.mjs artifacts/verification/fast-ci-benchmark.json
```

This compares the same protocol/engine library cohort using the ordinary and
temporary candidate profiles: empty build target, unchanged rerun, first-party
rebuild with dependencies retained, and test execution. Each profile owns a disposable
build tree. Cargo registry downloads may already be cached; a local result
does not qualify GitHub runner latency. Tactical
[`304`](docs/tactical/304-fast-pr-feedback-and-ci-benchmarks.md) owns the
comparison, rejected profile and hosted follow-up.

To distinguish Rust compilation from test execution using the CI commands:

```bash
cargo test --locked --workspace --no-run --timings
cargo test --locked --workspace
```

Cargo writes HTML reports under `target/cargo-timings/`; CI retains these for
seven days as `rust-build-timings-<run-id>-<attempt>`, including when a later
step fails. Doctest compilation remains in the execution command. Tactical
[`211`](docs/tactical/211-presubmit-signal-and-build-measurements.md) records
the failure diagnoses, measurements, and hosted-evidence boundary.

The ordinary dev and test profiles use optimized code with file-and-line
backtraces, debug assertions, and overflow checks, but omit full debugger
information and incremental compilation to keep macOS build artifacts
bounded. For a deliberate source-level debugger session, use the separate
full-debug profile:

```bash
cargo test --profile debugging -p rstorrent-engine
cargo run --profile debugging -p rstorrent-desktop
```

Its artifacts are isolated under `target/debugging` and can be removed without
discarding ordinary dev or release output:

```bash
cargo clean --profile debugging
```

### Local owner-relay product matrix

Tactical `192` retains one local-only production-shaped end-to-end runner:

```bash
node scripts/verify-remote-product.mjs
```

It builds the actual headless, gateway and TLS-relay binaries plus the
release-mode remote React/Wasm bundle. The run creates distinct loopback HTTPS,
WSS and headless origins, enables through the protected headless admin socket
and drives isolated persistent Chrome profiles through password login,
automatic resume, shared-browser non-persistence, relay restart, local
installed-layout rollback, audit, revocation and changed-host blocking. It
also checks the fixed CSP, immutable hashed assets and absence of service
workers. `openssl`, `curl`, the `wasm32-unknown-unknown` Rust target,
`wasm-bindgen-cli` matching the lockfile and the web workspace's Playwright
browser are prerequisites.

The runner binds only `127.0.0.1`, creates no external account or deployment,
and removes its temporary certificate, authority, browser profiles, payload,
relay state and processes in a `finally` path. Its older layout generation uses
the same working-tree binary and is lifecycle evidence, not signed
cross-version compatibility.

### Remote Pages artifact without deployment

Build the exact production remote controller and atomically assemble it with
the project website without publishing either surface:

```bash
source ~/.profile
BUILD_ID=$(git rev-parse HEAD)
VITE_RSTORRENT_REMOTE_RELAY_URL=wss://relay.rstorrent.com/client \
VITE_RSTORRENT_REMOTE_BUILD_ID="$BUILD_ID" \
  npm run build:remote --prefix clients/web
npm run check --prefix website
npm run build --prefix website
node scripts/assemble-pages-site.mjs "$BUILD_ID"
```

The assembler replaces only `website/dist/remote`, requires content-hashed
JS/CSS/Wasm, rejects service-worker files and registration, and writes a
public digest/build manifest. The website workflow performs this same build
before its existing pinned Wrangler deployment and then runs
`scripts/verify-remote-deployment.mjs` against the unique deployment URL. That
verifier checks the exact build/relay identity, every file digest and byte
count, remote-only CSP, no-store entry points, immutable assets, Wasm content
type and 404 service-worker paths. A local build does not activate remote
access or authorize a Cloudflare deployment.

## Localization

English is the only supported production locale. Every maintained product
surface has a checked source catalog; long-LTR and RTL pseudo locales are test
fixtures and must not enter release packages. Run the cross-product static
gate after presentation-copy changes:

```bash
node scripts/check-localization.mjs
node scripts/check-branding.mjs
```

Regenerate and validate the shared React catalog with:

```bash
npm run generate:localization --prefix clients/web
npm run typecheck --prefix clients/web
npm run test:e2e --prefix clients/web
```

Exercise Android's platform resources and configuration lifecycle with:

```bash
clients/android/build.sh
clients/android/scripts/run-localization-matrix.py
```

The matrix creates task-owned Pixel 6 API 28 and Pixel Tablet API 35 AVDs and
deletes them on exit. It never selects an arbitrary attached device.

Exercise iOS String Catalog extraction, import, and presentation with:

```bash
clients/ios/scripts/generate-project.sh
clients/ios/scripts/check-localization-roundtrip.sh
clients/ios/scripts/run-localization-matrix.sh
```

The round-trip check uses Xcode's `.xcloc` path in an isolated project copy.
The matrix creates task-owned iPhone and iPad simulators and deletes them on
exit. Catalog policy, translation provenance, first-locale criteria, and exact
platform workflows live in
[`docs/topics/localization.md`](docs/topics/localization.md).

## Launching The Desktop App

Install the locked web dependencies when necessary, build the static web
application and optimized debug Tauri binary, then launch without a Vite
server, listening port, or installer bundle:

```bash
./scripts/desktop
```

The wrapper runs npm from `clients/web`; no separate npm command is required.
Later runs reuse installed dependencies and Cargo build output while still
refreshing the static web assets. It also prepares the exact-target debug
native-host sidecar; direct Cargo tests remain independent of generated
sidecars. The process remains attached to the terminal so `Ctrl+C` stops it.

Build an unsigned native package with the explicit sidecar overlay:

```bash
cd clients/desktop
../web/node_modules/.bin/tauri build \
  --config src-tauri/tauri.package.conf.json \
  --bundles app --no-sign --ci
```

The package build cross-builds `rstorrent-native-host` for Tauri's exact
target triple. On desktop launch, RSTorrent copies that sidecar to a stable,
content-versioned per-user location, writes the bounded launch configuration,
and repairs exact Chrome native-host registration. AppImage registration
targets the stable AppImage path rather than its temporary mount.

Signed JSTorrent packaging and publication use the production sections below.
[`docs/desktop-release.md`](docs/desktop-release.md) retains the frozen
RSTorrent track's historical runbook and channel evidence; do not use its
incubation publication commands for new releases.

Validate desktop activation wiring and generated package metadata with:

```bash
node scripts/validate-desktop-release.mjs
node --test scripts/validate-desktop-release.test.mjs \
  scripts/validate-desktop-package.test.mjs
node scripts/validate-desktop-package.mjs --mac-app PATH/TO/RSTorrent.app
node scripts/validate-desktop-package.mjs \
  --linux-desktop PATH/TO/com.jstorrent.rstorrent.desktop
node scripts/validate-desktop-package.mjs \
  --windows-registry-json PATH/TO/installed-associations.json
node scripts/smoke-native-host.mjs PATH/TO/rstorrent-native-host
```

The Windows JSON is produced only after a silent per-user NSIS install and
must contain the installed executable, private torrent ProgID and command,
and magnet protocol marker/command. Installed acceptance invokes the OS
handler rather than launching the executable with a test-only shortcut, uses
controlled non-public magnets and tiny independently generated torrent files,
records process/catalog identity before and after warm activation, and restores
the inherited OS defaults and machine state afterward. Never print or persist
the complete magnet or source path in product logs.

## Building JSTorrent Production Candidates

The [cutover checklist](docs/jstorrent-cutover-checklist.md) owns full signed,
store and installed migration acceptance. Validate source identities/public
trust, build a production extension ZIP, and construct an unsigned desktop
bundle without launching it:

```bash
source ~/.profile
node scripts/validate-jstorrent-candidate.mjs
npm run package:jstorrent --prefix clients/extension
node scripts/build-jstorrent-desktop.mjs --unsigned --debug --bundles app
```

Desktop candidates merge the package/release overlay followed by
`tauri.jstorrent.conf.json`. Without `--unsigned`, the build requires the
existing JSTorrent `TAURI_SIGNING_PRIVATE_KEY`; final signatures must verify
against its retained public key before delivery. Android release now targets
`com.jstorrent.app` and requires original signing material under the runbook
below. Ordinary desktop/Android debug builds stay isolated. A production app
launch can migrate installed legacy state; use owned guests for installed tests.
Source versions exceed pinned legacy baselines; check all store tracks before
shipment. No build command above publishes or changes an update service.

JSTorrent is the sole active shipping lane. Its original signing inputs are
already configured under `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; do not reprovision or rotate them as part
of flavor cleanup. RSTorrent publication is frozen, including its gated nightly
workflow. Ordinary debug identities remain isolated. Build a manual
nonpublishing JSTorrent candidate with:

```bash
gh workflow run desktop-release.yml --repo kzahel/jstorrent --ref main -f production_candidate=true
```

The nonce proof and all six production updater payload signatures must verify
against the original public root. A diagnostic artifact from a failed
attempt does not qualify delivery. Publication remains gated by the cutover
checklist.

### Explicit production desktop publication

The existing workflow defaults to a nonpublishing production candidate. A
stable tag push also builds the production identity without publishing.
Tactical271 prepares publication only through an explicit manual dispatch
against the exact `desktop-v<version>` tag, with candidate mode disabled and
`production_publication=true`. Branch refs, nightly/source/version overrides
and simultaneous candidate mode refuse. Do not invoke this until the complete
cutover capsule is qualified and the maintainer explicitly authorizes this
publication. Tag creation/push remains a separate authorized operation.

Desktop 0.3.0 has already been published under Tactical295. For a future
qualified and explicitly authorized tag, the dispatch shape is:

```bash
gh workflow run desktop-release.yml --repo kzahel/jstorrent --ref desktop-vX.Y.Z -f production_candidate=false -f production_publication=true
```

The collector rechecks that the fetched tag still resolves to the exact built
source before draft creation and publication. It validates every same-run leg,
all original-root updater signatures and the complete private draft. Production
now requires 15 core assets, including six signature sidecars; `SHA256SUMS` is
an additional 16th support asset. Both production Linux lanes build AppImages
only on Ubuntu 24.04. The old 23-asset preview matrix is retained history, not
an active release target.
The website's curated inventory must match the new exact production asset set
when the final candidate is selected. Final native/store/public-route acceptance is not
implied by this workflow mode or local publisher tests.

## Packaging The JSTorrent Beta Extension Seed

Validate the Manifest V3 permission/local-code boundary and produce the exact
Chrome Web Store upload ZIP with:

```bash
npm test --prefix clients/extension
npm run package --prefix clients/extension
```

The artifact is written below `target/extension/`. Its manifest pins the public
key for Chrome Web Store item `gcgoepclopkgijmclmlheafaglmbjlcc`; validation
derives that same unpacked identity and the desktop host permits only its exact
origin beside the existing production JSTorrent origin. Upload new packages to
that same draft item. Never commit the private key or store credentials.

## ChromeOS Qualification Builds

Build on the Linux controller; physical Chromebooks are runtime targets.
Tactical 253 uses the native Ubuntu 22.04 Crostini baseline:

```bash
source ~/.profile
scripts/build-crostini-baseline.sh
```

This Docker build isolates host libc and credentials, installs pinned Rust
1.97.0/Node 22.22.0, runs the existing package validator, and reports ELF/ldd
requirements plus executable version smokes. Finished packages are under
`target/crostini-baseline/packages/`. The native ARM64 release lane remains
`ubuntu-22.04-arm`; this local x86_64 script does not emulate that qualification.

Validate the Crostini dedicated-localhost route and browser-session isolation
without DNS overrides or the user's installed browser:

```bash
cargo build -p rstorrent-gateway --bin rstorrent-gateway
node scripts/verify-crostini-localhost.mjs target/debug/rstorrent-gateway
```

The runner owns its temporary profile, gateway, neighboring HTTP fixture and
bundled headless Chromium. It checks actual cookie host separation, exact
Host/Origin refusal and paired-session restart, then joins/removes its fixtures.

Preserve inherited physical Android apps with the debug-only test identity:

```bash
source ~/.profile
ORG_GRADLE_PROJECT_chromeosQualificationTestPackage=org.rstorrent.qualification253 \
  clients/android/build.sh
```

It cannot be combined with the production-identity legacy-upgrade override.
Release identity/signing stay unchanged. Verify the APK's actual package before
installation and remove only this owned test package afterward. This is a
sideloaded controlled cohort, never a real Play installation/update pass.

Check saved run intent through normal folder repair in a fresh owned API35
emulator with:

```bash
source ~/.profile
uv run --project tests/interop --locked python tests/interop/android_saf_repair_intent.py \
  --apk clients/android/app/build/outputs/apk/debug/app-debug.apk \
  --output .local/android-saf-repair-intent
```

The output directory must not exist. Install the host-native API35 Google APIs
system image first. This checks a real controlled download, closes its source,
uses normal Shutdown and folder Repair, and independently verifies paused and
running intent plus bytes through cold reopen. Screenshots and receipts remain
local. It owns and reaps the emulator and temporary AVD; it never installs into
an inherited device or qualifies production store delivery.

The packaged portable failure journeys use an owned test Chromium:

```bash
node scripts/verify-chromeos-onboarding.mjs target/extension/jstorrent-1.1.2.zip
```

Install Playwright Chromium if absent. The runner extracts the exact ZIP,
retains its manifest-derived origin, drives six Android and ten Linux explicitly
injected scenarios, plus a real-HTTP-cache package-replacement fixture,
and removes its browser/profile/staging state. The cache fixture binds owned
loopback port 3030 and maps only the test browser's Linux hostname to it; leave
that port free and run archive checks sequentially. It does not contact a device.

## Packaging And Running The Linux Headless Service

On native x86_64 Linux, build and validate the ordinary-user package with:

```bash
source ~/.profile
scripts/build-headless-package.sh
scripts/validate-headless-package.sh \
  target/headless/rstorrent-headless-0.1.1-linux-x86_64.tar.gz
```

The same no-argument command on native ARM64 emits the `aarch64` archive. For
an explicit cross construction, first produce target-appropriate
`rstorrent-headless` and `rstorrent-gateway` ELF binaries, then run:

```bash
scripts/build-headless-package.sh \
  --architecture aarch64 \
  --binary-directory "$PWD/target/aarch64-unknown-linux-gnu/release"
scripts/validate-headless-package.sh \
  target/headless/rstorrent-headless-0.1.1-linux-aarch64.tar.gz
```

Cross-host validation checks the complete archive and ELF architecture but
cannot execute target binaries; run the same validator natively or under a
controlled emulator before making a runtime claim.

Extract one package into an ordinary-user-owned directory and run its
`install.sh`. Installation writes immutable versions, a stable command link,
a protected configuration example, and
`com.jstorrent.rstorrent.headless.service`; it does not start or enable the
unit and never changes lingering. Follow the printed steps to copy/edit
`~/.config/rstorrent/headless.toml`, protect it with mode `0600`, and then
enable explicitly:

```bash
systemctl --user enable --now com.jstorrent.rstorrent.headless.service
$HOME/.local/bin/rstorrent-headless status
journalctl --user -u com.jstorrent.rstorrent.headless.service
```

### Optional local deploy after pushing `main`

On a Linux checkout that owns the ordinary-user headless development service,
install the tracked lightweight push hook with:

```bash
scripts/local-deploy/install-hook.sh
```

The hook records a `main` update and returns immediately. A detached worker
waits until the remote branch reports the exact pushed commit, exports that
commit into a temporary `git archive` snapshot, builds and validates the
package, and runs the existing health-checked installer. It neither builds
from mutable working-tree files nor maintains a sibling Git worktree.

Inspect or cancel the finite local worker with:

```bash
scripts/local-deploy/deploy-after-main-push.sh --status
scripts/local-deploy/deploy-after-main-push.sh --log
scripts/local-deploy/deploy-after-main-push.sh --stop
```

State and bounded logs live below
`.git/rstorrent-deploy-after-main-push/`. A scheduling or deployment failure
is recorded there and never rejects the Git push. This local automation does
not enable the service or change configuration, firewall, network, release,
or update-channel state. See
[`scripts/local-deploy/README.md`](scripts/local-deploy/README.md) and Tactical
[`209`](docs/tactical/209-asynchronous-local-headless-deploy.md).

After an exact `headless-v*` candidate and website bootstrap are separately
published, the intended first-install route is the pinned-key
`website/public/install-headless.sh`. It selects x86_64 or ARM64, downloads
bounded HTTPS metadata, verifies the signed manifest plus package size/hash/
identity, and then invokes that same ordinary-user installer. The current
source tree does not imply that a public headless channel has been promoted.

Installed updates use the signed stable manifest rather than GitHub's
repository-wide `latest` release. Checking is read-only; applying is an
explicit operator action that delegates to the existing health-checked,
rollback-safe installer:

```bash
$HOME/.local/bin/rstorrent-headless update --check
$HOME/.local/bin/rstorrent-headless update --apply
```

The browser uses the same backend verifier for quiet startup/daily checks and
visible manual results. It displays the exact shell command but cannot install
a package or restart the service.

Hosted `index.html` and the classic boot guard are intentionally `no-store`;
content-hashed `/assets/*` files are immutable. Preserve that split across
gateway or packaging changes: same-version repair may replace the shell and
prune old hashed assets. The initial shell shows loading, disabled-JavaScript,
or bounded module-start failure text rather than leaving a blank page.

For a deliberately credential-free trusted home LAN, configure one exact
non-loopback RFC 1918 address and its matching plain HTTP origin:

```toml
listen = "192.168.1.129:3030"
public_origin = "http://192.168.1.129:3030"

[authentication]
mode = "lan-none"
```

Do not use a wildcard, public address, port forward, guest network, or
untrusted overlay. This mode has no authentication or encryption: every
device that can reach the selected address has full owner control. Exact Host
and HTTP/WebSocket Origin checks still apply, and status, health, logs, and the
React UI report the effective exposure. React presents the full explanation
once per browser origin and keeps a compact `No auth` header status after it is
dismissed. Clearing site data or changing the notice-key version presents the
explanation again.

For simultaneous trusted-LAN and Tailscale access, keep the direct LAN socket
exact and add a second exact loopback backend for Tailscale Serve. Do not bind
RSTorrent to `0.0.0.0` or directly to its Tailscale address. Back up the
owner-protected version-1 configuration before replacing it with version 2:

```toml
version = 2
profile_root = "/home/operator/.local/share/rstorrent-headless/profile"

[[endpoints]]
kind = "direct-lan"
listen = "192.168.1.129:3030"
public_origin = "http://192.168.1.129:3030"

[[endpoints]]
kind = "tailscale-serve"
listen = "127.0.0.1:3031"
public_origin = "https://server.tailnet-name.ts.net:8445"

[[storage_roots]]
id = "downloads"
label = "Downloads"
path = "/home/operator/Downloads/RSTorrent"

[authentication]
mode = "trusted-network-none"
```

Protect the file with mode `0600`, restart the user unit, verify its direct
loopback health with the exact external Host, inspect the existing Serve
configuration, and then add only the selected unused HTTPS port:

```bash
curl --fail --header 'Host: server.tailnet-name.ts.net:8445' \
  http://127.0.0.1:3031/healthz
tailscale serve status
sudo tailscale serve --bg --https=8445 http://127.0.0.1:3031
tailscale serve status
```

Tailscale Serve owns the tailnet listener, HTTPS certificate, and tailnet
policy boundary; RSTorrent owns the exact loopback backend plus external Host
and Origin checks. RSTorrent adds no login in this mode, so every tailnet
identity permitted to reach the Serve route has full owner control. Do not
enable Funnel. Preserve unrelated Serve routes, and treat ACL changes as a
separate operator security decision. Version-1 configuration remains accepted
for single-endpoint deployments and is the rollback path if the new endpoint
cannot be admitted.

The package deliberately does not change firewall policy. If UFW is active,
an operator who accepts the entire selected LAN as trusted must add an exact
source, destination, and port rule separately. The current workstation uses:

```bash
sudo ufw allow from 192.168.1.0/24 to 192.168.1.129 \
  port 3030 proto tcp comment 'RSTorrent Headless LAN'
```

Inspect the existing rules before adding it. Do not replace the destination
with `any`, add an IPv6 twin, or broaden the source unless that exposure is a
separately reviewed choice. The exact reversal is:

```bash
sudo ufw delete allow from 192.168.1.0/24 to 192.168.1.129 \
  port 3030 proto tcp
```

Running a new package's `install.sh` performs a same/new-version repair and
restores prior running/enabled intent only after its configured identity and
readiness check.
Normal removal preserves the operator configuration, secret, profile, and all
payload roots:

```bash
$HOME/.local/bin/rstorrent-headless uninstall
```

The package does not configure TLS, DNS, a firewall, or a reverse proxy. Basic
hosted mode expects an operator-owned HTTPS/WSS terminator and enforces the
configured external Host and Origin itself. See
[`runtime-configurations-and-headless-deployment.md`](docs/topics/runtime-configurations-and-headless-deployment.md)
and Tacticals [`170`](docs/tactical/170-configured-linux-headless-service.md)
and [`171`](docs/tactical/171-signed-headless-release-and-lan-service.md), plus
[`174`](docs/tactical/174-exact-tailnet-headless-access.md), for the fixed
contract and evidence. The current workstation deployment is one enabled
healthy user service with the exact direct LAN listener at
`http://192.168.1.129:3030/` and one loopback-only backend behind its exact
Tailscale Serve HTTPS authority. A persistent exact UFW rule admits LAN TCP
3030 only from `192.168.1.0/24` to that address; no IPv6, public, router,
Funnel, ACL, or system-wide service change was made.

## Launching The Live Web UI

For the ordinary headless product path with persistent first-run browser
authentication, build the bundle and gateway, provision a local profile, and
run `serve`:

```bash
VITE_RSTORRENT_DEFAULT_LIVE=same-origin npm run build --prefix clients/web
cargo build -p rstorrent-gateway --bin rstorrent-gateway
mkdir -p .local/headless-web/downloads
RSTORRENT_STORAGE_ROOT="$PWD/.local/headless-web/downloads" \
  target/debug/rstorrent-gateway serve \
  --profile-root .local/headless-web/profile \
  --listen 127.0.0.1:3030 \
  --origin http://127.0.0.1:3030 \
  --auth auto \
  --web-root "$PWD/clients/web/dist" \
  --build-id local \
  --open
```

A fresh profile shows the ten-minute setup choice. If paired access was
selected and every authorized browser cookie is later lost, stop the gateway
and repeat the same command with `--pairing-window`; the first browser that
explicitly approves itself during that ten-minute window is remembered.
`rstorrent-gateway serve --help` documents Basic, bearer, fixed-policy, secret
file, listener, and no-open options. Secret values are never CLI arguments.

The maintainer launcher below deliberately remains a friction-free,
ephemeral, unauthenticated loopback development mode; it does not exercise or
change the persistent product policy.

The shared React product UI can run against a real online application service
in the normal browser without launching Tauri:

```bash
./scripts/webui
```

The launcher installs locked web dependencies when needed, builds production
web assets and the Rust gateway, and starts one gateway on the stable loopback
origin. That process serves the assets, HTTP API, and WebSocket endpoint, and
the launcher opens the plain root URL in the default browser. It remains
attached to the terminal; one `Ctrl+C` gracefully stops and joins the process.
The browser tab itself may remain open and will reconnect after the next
launch.

For live React/CSS iteration, stop the ordinary launcher and run:

```bash
./scripts/webui --reload
```

The browser URL and `.local/webui` profile stay the same. Vite serves the
page with hot reload while the gateway runs on a private loopback port; API,
WebSocket, and media requests pass through the visible browser origin. The
launcher still builds the Rust gateway at startup. Rust changes require a
restart; UI source changes do not. `--reload --no-open` skips the browser
opener. The ordinary launcher continues to serve a production build that
changes only when rebuilt or restarted.
Edits to `clients/web/src/localization/messages/en.json` still need
`npm run generate:localization --prefix clients/web` to refresh the compiled
catalog; Vite then reloads that generated file.

Web UI state and downloads persist beneath `.local/webui`, which is separate
from the Tauri application profile and ignored by Git. Override that location
with `RSTORRENT_WEBUI_DATA_ROOT` or the hosted application port with
`RSTORRENT_WEBUI_PORT`. `./scripts/webui --no-open` starts the same server
without disturbing the visible browser and is the automation/debug form.

The launcher selects online torrent networking by default. This is the same
React UI embedded by Tauri, with a browser transport in place of Tauri's
in-process adapter. Paste a magnet into the toolbar and use Add or Enter;
unsupported remote `.torrent` URLs are rejected without clearing the input.
More > Add test torrent exposes the five recorded WebTorrent magnets for quick
interactive testing. These are variable public swarms, not deterministic
success fixtures. Empty Add opens the shared local `.torrent` chooser; v1 and
strict complete-source pure-v2 or hybrid files use the same root, selection,
and start controls. The Android Compose UI remains a separate platform
presentation.

## Exercising The Frontend Headlessly

The named demo adapter drives the responsive React inspection application
without launching Tauri, starting Rust, or using torrent networking. Start the
local development host when manual browser inspection is wanted:

```bash
npm run dev --prefix clients/web -- --host 127.0.0.1
```

Then open a deterministic scenario such as:

```text
http://127.0.0.1:5173/?demo=healthy-download&at=42000&autoplay=0
http://127.0.0.1:5173/?demo=tracker-recovery&at=30000&autoplay=0
http://127.0.0.1:5173/?demo=large-swarm&at=0&autoplay=0
```

The stable scenario IDs are `healthy-download`, `stalled-metadata`,
`tracker-recovery`, `endgame`, `large-swarm`, `disk-error`, and
`empty-library`. Omit `autoplay=0` for a running demo clock. Bundled headless
Playwright Chromium validates wide, compact, phone, accessibility, keyboard
and virtualized-scale behavior without touching the primary installed browser:

```bash
npm run test:e2e --prefix clients/web
```

Install the separately identified test browser with `npx playwright install
chromium` from `clients/web` if needed. The Playwright configuration uses that
browser locally and in CI, reaping it and the managed Vite server after each
run. Do not select the primary installed Chrome for temporary-profile captures.
For managed-package update guidance and support diagnostics, use the focused
renderer suite:

```bash
npm run test:e2e --prefix clients/web -- support-diagnostics.spec.ts
```

Its MSI/DEB/RPM/unknown fixtures use real initial controller state and label
captures as renderer evidence. They do not substitute for installed native
package and updater qualification.

The opt-in tracker countdown runner uses an independently authored bounded
loopback UDP tracker, a temporary Rust gateway profile and production React
build in bundled Playwright Chromium. It samples decreasing countdowns through
unrelated rate updates, tab reopen and reload, and checks the stable backend
deadline. It joins every process/thread and removes profile/payload data. The
optional PNG is renderer evidence, not installed desktop acceptance:

```bash
source ~/.profile
uv run --project tests/interop --locked \
  python tests/interop/tracker_countdown_surface.py \
  --screenshot-dir .local/evidence/300-tracker-clock
```

The opt-in production UI bandwidth baseline starts a clean gateway and
production preview, preloads a 12-row Library, keeps one deterministic
libtorrent-seeded transfer rate-limited and active, and measures exact
application-frame bytes across Transfers and selected Workbench details. It
uses one WebSocket, asserts no semantic HTTP, cross-checks browser totals with
gateway counters, and removes every temporary owner. The result is application
payload plus a basic WebSocket framing estimate, not TLS/IP or billed cellular
traffic:

```bash
source ~/.profile
uv run --project tests/interop --locked \
  tests/interop/application_ui_bandwidth.py \
  --output /tmp/rstorrent-ui-bandwidth-baseline.json
```

The deterministic first-piece interoperability scenario uses its own locked
Python environment and a loopback-only Rasterbar libtorrent seed:

```bash
uv run --project tests/interop --locked \
  python tests/interop/first_verified_piece.py --runs 3
```

The complete-source pure-v2 runtime scenario generates independent BEP 52
single-file and aligned multi-file fixtures, then transfers each one in both
RSTorrent/libtorrent roles over loopback TCP. It repeats application-owned
seeding after restart, covers selective file download, forces RC4 MSE in both
initiated roles, and proves tracker- and DHT-discovered default-uTP download.
It also exercises `btmh` plus direct-peer-hint magnets in both roles, captures
BEP 52 hash exchange, promotes selected files, reconstructs complete trees
after restart, repairs one corrupt leaf, and accepts a uTP-only libtorrent
leecher through the shared session UDP owner. The harness verifies exact
payload and versioned identities, enforces resource high-water bounds, and
removes all temporary state:

```bash
uv run --project tests/interop --locked \
  python tests/interop/pure_v2_runtime.py
```

The hybrid runtime scenario generates an aligned multi-file BEP 52 hybrid and
transfers exact selected content in both RSTorrent/libtorrent roles through
the legacy-to-v2 upgrade and direct-v2 entry lanes. It promotes selection,
restarts from local verified content, forces RC4 MSE, uses default uTP, checks
the exact v1 and v2 tracker/DHT keys, serves complete content, enforces
resource bounds, and removes every temporary owner and artifact:

```bash
uv run --project tests/interop --locked \
  python tests/interop/hybrid_runtime.py
```

The authenticated production-browser lifecycle keeps one v1 control paused,
adds a complete pure-v2 source through the binary WebSocket operation, changes
file selection, completes exact wanted bytes over uTP, forces a recheck, and
restarts without uploading the source again. A second phase adds a pure-v2
`btmh` magnet with one peer hint and select-only intent, captures metadata/hash
wire use, checks skipped output and canonical export, restarts from local
verified content, and removes exact downloaded data. It also checks accessibility,
semantic transport use, gateway resource bounds, part-artifact absence, and
temporary cleanup:

```bash
uv run --project tests/interop --locked \
  python tests/interop/browser_torrent_file_intake.py
```

The production-browser hybrid scenario adds the two exact magnet topics
separately, proves atomic reconciliation into one row with both identities,
applies exact file selection, completes and restarts locally, captures hash
and payload service, removes the owner exactly, checks accessibility, and
asserts bounded gateway cleanup:

```bash
uv run --project tests/interop --locked \
  python tests/interop/browser_hybrid_runtime.py
```

The incomplete-file streaming profile uses a throttled pinned-libtorrent seed
and a TCP capture proxy. It proves exact concurrent head, tail, seek, and
overlap ranges while content is incomplete, then keeps one full active body
alive as the final bytes become verified and records bounded demand/request
order:

```bash
uv run --project tests/interop --locked \
  python tests/interop/incomplete_file_streaming.py \
  --output target/incomplete-file-streaming-evidence.json
```

Tactical `001`'s bounded large-piece profile streams a deterministic 32 MiB
fixture through a 256 KiB engine-owned payload allowance:

```bash
uv run --project tests/interop --locked \
  python tests/interop/first_verified_piece.py --large-piece --runs 3
```

Tactical `002`'s selective profile forces boundary, skipped-only, padding,
zero-length, final-short, reopen, and materialization behavior:

```bash
uv run --project tests/interop --locked \
  python tests/interop/first_verified_piece.py --selective-files --runs 3
```

The representative selective-hash profile downloads 32 MiB in 128 pieces
across three unaligned wanted files. It checks exact final-path content and
cleanup while retaining transfer-only timings for storage-operation changes:

```bash
uv run --project tests/interop --locked \
  python tests/interop/selective_hash_profile.py --runs 3
```

Use its 128 MiB, 512-piece steady preset when startup would dominate the
historical smoke:

```bash
uv run --project tests/interop --locked \
  python tests/interop/selective_hash_profile.py --profile steady --runs 3
```

The application-service checkpoint profile exercises the same piece count
through SQLite-backed durable resume and reports the durable revision
amplification from metadata checkpoint to verified completion:

```bash
uv run --project tests/interop --locked \
  python tests/interop/session_checkpoint_profile.py --runs 3
```

The checkpoint crash matrix pauses the diagnostic child at the exact
pre-sync, post-sync/pre-commit, and post-commit boundaries. It kills only that
owned child, verifies SQLite have state, distinguishes physically valid false
negatives from committed trust, confirms that a stable completed neighbor does
not enter checking, checks exact restart payload, and removes every temporary
artifact:

```bash
uv run --project tests/interop --locked \
  python tests/interop/session_checkpoint_crash.py --scenario all
```

The ordinary-resume/Force scenario also proves the intentional trust boundary:
same-length external mutation can pass structural fast resume, while explicit
Force performs a fresh full check and clears it. The unified oracle combines
that behavior with BEP 3 topology, direct-file crash recovery, and
pinned-libtorrent comparison phases:

```bash
uv run --project tests/interop --locked \
  python tests/interop/session_resume.py --runs 1
uv run --project tests/interop --locked \
  python tests/interop/unified_resume_recheck.py --phase all
```

The controlled DHT profile obtains peers from an independent KRPC router,
downloads metadata and content from libtorrent, and then probes RSTorrent's
incoming query and token-authenticated announcement behavior:

```bash
uv run --project tests/interop --locked \
  python tests/interop/dht_magnet.py
```

The dual-stack profile adds direct IPv6 TCP transfer, a DHT-only
pinned-libtorrent leecher that discovers RSTorrent through its IPv6 node, and
incoming BEP 32 `want`, `nodes6`, peer-value, token, and announcement probes:

```bash
uv run --project tests/interop --locked \
  python tests/interop/ipv6_dht.py
```

The opt-in IPv6 firewall-pinhole gate requires the existing off-LAN verifier
SSH alias or destination. It proves the negative control, creates one finite
`WANIPv6FirewallControl:1` TCP pinhole through the ordinary live settings
path, hash-verifies exact incoming payload, checks a positive packet count,
deletes the pinhole while the listener remains active, requires typed `704`,
and repeats the failed dial:

```bash
RSTORRENT_OFF_LAN_SSH_TARGET=YOUR_TARGET \
  uv run --project tests/interop --locked \
  python tests/interop/ipv6_pinhole_seeding.py
```

The harness never prints or persists the SSH target, listener address,
gateway identity, control URL, or pinhole ID. Without the environment value it
reports a structured skip. With a value, an identity-free bounded SSH/Python/
IPv6-socket preflight must pass before the harness creates a fixture, builds,
starts a listener, or mutates the gateway.

The opt-in public metadata-only profile starts one session UDP owner with both
available families and records per-family DHT endpoints, routing thresholds,
queries, responses, peer values, and datagram bytes. Public outcomes vary and
do not claim incoming IPv6 reachability:

```bash
uv run --project tests/interop --locked \
  python tests/interop/public_compare.py \
  --torrent big-buck-bunny --profile dht --owner rstorrent \
  --target metadata --runs 1 --timeout-seconds 150 \
  --cleanup-seconds 10 --output /tmp/rstorrent-public-ipv6.json
```

The uTP default-readiness observation is a separate one-shot profile. It uses
the catalogued Big Buck Bunny magnet, verifies metadata only, starts fixed uTP
on the shared session UDP owner, permits at most 30 peers, and removes its fresh
temporary root. It never maps or advertises an incoming endpoint. Run it only
when a tactical explicitly authorizes the public attempt:

```bash
uv run --project tests/interop --locked \
  python tests/interop/utp_public_observation.py \
  --allow-public-network
```

The report contains endpoint-free TCP/uTP capability aggregates and terminal
UDP/uTP resource counters. A safely cleaned timeout or lack of a uTP-capable
peer is evidence-limited rather than a deterministic test failure.

The advertisement profile independently discovers a completed RSTorrent seed
through either a controlled UDP tracker over TCP or DHT over forced uTP and
hash-verifies both libtorrent downloads without an explicit peer hint. The DHT
case verifies the product's explicit UDP-listener port on the wire, exactly one
peer, bidirectional uTP packets, and zero TCP peers:

```bash
uv run --project tests/interop --locked \
  python tests/interop/advertised_seeding.py
```

Its opt-in physical mode additionally requires an operator-controlled off-LAN
SSH destination. It verifies that tracker wire traffic carries the mapped TCP
port while DHT carries the independently mapped UDP/uTP port, transfers over
TCP through the tracker-observed endpoint, deletes both mappings, and proves
the TCP endpoint is then unreachable. The destination value and network
identities are never printed or persisted:

```bash
RSTORRENT_OFF_LAN_SSH_TARGET=YOUR_TARGET \
  uv run --project tests/interop --locked \
  python tests/interop/advertised_seeding.py --mapped-external
```

The product incoming-uTP physical gate uses the ordinary session-owned UDP
lease rather than a diagnostic-owned mapping. A pinned libtorrent leecher on
the selected off-LAN host dials that public UDP endpoint directly with TCP
disabled, verifies the exact payload, and leaves no mapping, process, remote
run directory, or local temporary directory:

```bash
uv run --project tests/interop --locked \
  python tests/interop/product_utp_reachability.py --host YOUR_TARGET
```

The controlled mixed-peer profile keeps a scripted, valid, permanently choked
peer in the content swarm while pinned libtorrent supplies and accounts for a
16-piece single-file payload:

```bash
uv run --project tests/interop --locked \
  python tests/interop/multi_peer_liveness.py
```

The incomplete-torrent duplex profile gives each participant a complementary
sparse set over wanted, skipped, padding, cross-file, and part-backed routes.
It captures Piece frames in both directions before completion for ordinary,
Fast, and forced-MSE peers, verifies exact final hashes, and exercises accepted
fast-resume route reconciliation. Its additional limited case composes a
16 KiB/s torrent upload/download cap beneath a 24 KiB/s session cap and checks
both directional byte bounds, throttle waits, and terminal quota drain:

```bash
uv run --project tests/interop --locked \
  python tests/interop/incomplete_duplex.py
```

The product uTP profile exercises the ordinary IPv4/plaintext application
default: dynamic 548--1,472 packetization when fragmentation protection is
verified and fixed 548 otherwise. It verifies incoming and outgoing exact
transfers against pinned libtorrent under a 256-KiB/s application stream-byte
cap, then proves a joined uTP timeout and sequential TCP fallback against a
TCP-only seed. The separate incomplete-duplex profile explicitly selects
`TcpOnly` to retain its transport-isolated TCP, Fast, and MSE baseline:

```bash
uv run --project tests/interop --locked \
  python tests/interop/utp_product_integration.py
```

The Android path-MTU closure harness cross-builds the focused diagnostic for
both native ABIs, owns a no-window API 34 AVD, and proves actual protected-send
option behavior across socket replacement. It then downloads the exact
controlled fixture through the real `ApplicationService` from pinned
libtorrent over the emulator's private host gateway, with public DHT bootstrap
disabled and zero TCP peers required, before checking terminal and filesystem
cleanup:

```bash
uv run --project tests/interop --locked \
  python tests/interop/android_utp_path_mtu.py \
  --avd jstorrent-tablet
```

The smaller incoming-uTP reachability parity gate reuses both ABI builds and
owns a no-window API 34 AVD. It starts the real application with mapping
disabled, verifies independent TCP and UDP status plus the actual uTP listener,
then proves joined application, mapping-owner, AVD, and filesystem cleanup:

```bash
uv run --project tests/interop --locked \
  python tests/interop/android_utp_reachability_status.py \
  --avd jstorrent-tablet
```

The real-socket uTP impairment fixture retains its six-profile explicit
fixed-548 regression by default. `--product-mtu` runs clean 1,500-byte and
controlled 1,280-byte product-MTU paths; `--efficiency` runs five alternating
fixed/dynamic clean-path pairs and checks packet-count, time, CPU, RSS, queues,
integrity, and cleanup. `--long-rtt` runs the 16 MiB pinned-libtorrent leech
oracle through a clean 160 ms RTT. The production-role companion runs an exact
64 MiB RSTorrent seed/leech transfer through the same bounded delay and checks
one connection, zero queue drops/retry exhaustion, resource high waters,
integrity, and cleanup:

```bash
uv run --project tests/interop --locked \
  python tests/interop/utp_runtime_impairment.py --product-mtu
uv run --project tests/interop --locked \
  python tests/interop/utp_runtime_impairment.py --efficiency
uv run --project tests/interop --locked \
  python tests/interop/utp_runtime_impairment.py --long-rtt
uv run --project tests/interop --locked \
  python tests/interop/utp_runtime_long_rtt_product.py
```

The concurrent-torrent profile downloads independent deterministic fixtures
from separate pinned-libtorrent source sessions. It alternates recorded case
order, checks the single-torrent and two-torrent throughput gates, and reports
per-torrent progress plus CPU, RSS, session resources, handles, peers, and
shutdown across the 1/2/3/4/8 sweep:

```bash
uv run --project tests/interop --locked \
  python tests/interop/multi_torrent_throughput.py \
  --output /tmp/rstorrent-multi-torrent.json
```

The hierarchical rate-policy variant preconfigures durable session and
per-torrent download limits, restarts before transfer, and checks session and
torrent caps plus torrent-first fairness with a three-peer versus one-peer
imbalance. The bounded smoke uses 2 MiB fixtures and 256 KiB pieces:

```bash
uv run --project tests/interop --locked \
  python tests/interop/multi_torrent_throughput.py \
  --rate-policy --size-mib 2 --piece-size-kib 256 --runs 1 \
  --output /tmp/rstorrent-rate-policy.json
```

The presubmit Android runtime gate creates and removes a private API 35 AVD,
then runs the existing product SAF file-selection/restart/recheck/removal
cohort. Install `system-images;android-35;google_apis;arm64-v8a` on ARM64 or
`system-images;android-35;google_apis;x86_64` on x86_64, configure `ANDROID_HOME`
or `ANDROID_SDK_ROOT`, and build the debug APK first:

```bash
uv run --project tests/interop --locked \
  python scripts/android-runtime-smoke.py --output /tmp/android-runtime.json
```

It owns the emulator process group, enforces a ten-minute runtime and four-MiB
console bound, and writes only an allowlisted outcome/resource report. It
never selects a user's existing AVD or physical device. Linux CI requires KVM.

The Android product concurrency profile uses the same generated application
contract and Android session limits. It applies a 24 KiB/s peer download
limit before adding torrents and requires an explicit target, two active
downloads plus one queued promotion, cap accounting, terminal bandwidth
drain, and exact payload hashes. It then sets active seeds to one and verifies
exact `1 active / 2 queued` truth, pinned goal defaults, foreground reopen,
optional background ownership, disablement, bounded resource/file-descriptor
high-waters, and cleanup:

```bash
clients/android/build.sh
python3 clients/android/run_bootstrap.py \
  --target pixel7a --profile product-concurrent-downloads --no-build
```

Use the same profile without a visible emulator window for routine parity:

```bash
uv run --project tests/interop --locked \
  python clients/android/run_bootstrap.py \
  --target avd --avd jstorrent-tablet \
  --profile product-concurrent-downloads --runs 1 --no-build
```

The Android SAF incomplete-duplex profile stores a two-piece partial torrent
directly, revokes and repairs its provider grant across process restart, then
exchanges complementary Fast payload with pinned libtorrent before completion.
It checks exact wanted hashes, absent skipped/padding files, resource high
waters, and exact data cleanup:

```bash
clients/android/build.sh
python3 clients/android/run_bootstrap.py \
  --target avd --avd jstorrent-tablet --storage saf-internal --runs 1 \
  --profile product-incomplete-duplex --no-build
```

The bounded Android legacy upgrade rehearsal owns fresh API 28/35 emulators
and temporary APKs/certificates. It downloads and verifies the pinned public
JSTorrent 1.0.24 APK, makes a real released-app SAF selection, seeds controlled
source-format torrent/settings data, and replaces it with the new debug APK
under `com.jstorrent.app`. No production key or attached physical device is
used. Run serially after generating both native ABIs/bindings:

```bash
source ~/.profile
clients/android/build.sh
PYTHONDONTWRITEBYTECODE=1 python3 clients/android/scripts/run-legacy-upgrade.py --api 28
PYTHONDONTWRITEBYTECODE=1 python3 clients/android/scripts/run-legacy-upgrade.py --api 35
```

The runner checks retained UID/source data/grants, mapped settings and selection,
ordinary intact/corrupt/private payload checking, restart, revocation/regrant
and no resurrection after private-profile clearing. It deletes its emulator,
AVD, APKs and disposable key, then restores ordinary incubation build identity.
Ordinary-writer mode instead drives the released Compose settings and content
intake, downloads independent fixtures from a loopback libtorrent seed through
ADB reverse, selects two SAF roots, and replaces the running old app. It checks
successor verification/resume, restart and reboot without inserting source KV
or preferences:

```bash
source ~/.profile
PYTHONDONTWRITEBYTECODE=1 uv run --project tests/interop --locked \
  python clients/android/scripts/run-legacy-upgrade.py --api 35 --source ordinary
```

The platform-only `legacy-upgrade-fixture` module exists because the minified
released APK cannot provide the current test runner's Kotlin dependencies.
Only the source seed uses it; successor assertions use ordinary instrumentation.
This qualifies the controlled old APK/source format, not Play signing or every
historical profile. Optional `--evidence-dir <new-owned-directory>` retains
actual before/after/failure emulator captures, UI attributes and bounded scoped
logs; it refuses an existing output directory. The owned emulator and all
temporary keys/APKs/fixtures are still removed after the run. Capture output is
an intentional local review artifact, not a store-qualified screenshot. Capture
waits for the actual Live imported library and retains first-use disclosure
separately. The replacement topic owns cutover gaps and wider gates.

Extension-driven mode uses the pinned released extension in owned Playwright
Chromium, its actual settings/intake/session writers, real old Android pairing
and two SAF roots. It exercises old/new version pairs, installed import/resume,
restart and fresh successor pairing/control. Package the successor extension
first, then run serially on API 28 and 35:

```bash
npm run package --prefix clients/extension
PYTHONDONTWRITEBYTECODE=1 uv run --project tests/interop --locked \
  python clients/android/scripts/run-legacy-upgrade.py --api 35 --source companion
```

The runner emulates the fixed ARC address inside its owned rooted AVD and
pre-grants only the extracted successor extension's exact optional permission.
It does not alter phone product policy, attached devices, physical apps or
shipping extension manifests. This is controlled evidence, not actual store
or physical ARC replacement; Tactical 248 records its precise limits.
With `--evidence-dir`, the browser also retains each actual old/new pair at
390/1100 pixels. The local fixture uses length-delimited HTTP/1.1 responses
and a bounded emulator reachability probe; tracker receipts distinguish a
fixture failure from a completed ordinary writer. Tactical284 records the
current-source API35 repeat and its presentation finding.

Tactical `003`'s self-contained Android probe builds both supported native
ABIs and targets only an explicitly verified environment:

```bash
experiments/android-storage-probe/build_probe.sh
python3 experiments/android-storage-probe/run_probe.py \
  --target avd --avd jstorrent-tablet --runs 3 --no-build
python3 experiments/android-storage-probe/run_probe.py \
  --target chromeos --runs 3 --no-build
python3 experiments/android-storage-probe/run_probe.py \
  --target pixel7a --runs 3 --no-build
python3 experiments/android-storage-probe/run_probe.py \
  --target motox4 --storage internal --runs 3 --no-build
python3 experiments/android-storage-probe/run_probe.py \
  --target motox4 --storage sdcard --runs 3 --no-build
```

Android and desktop tacticals should add the smallest meaningful build, smoke,
interoperability, and physical-device gates for the behavior they introduce.
Record exactly what ran in the tactical.

Documentation-only changes should at least run:

```bash
git diff --check
```

## Local Reference Checkouts

Reproduce and validate the local reference set with:

```bash
python3 scripts/references.py sync
python3 scripts/references.py status
```

Pinned external source checkouts live under the gitignored `reference/`
directory. The main local behavioral reference remains the first-party sibling
at `~/code/jstorrent`. See [`reference/README.md`](reference/README.md) and
[`reference/pins.toml`](reference/pins.toml) for their roles and exact
revisions.

The original BEP sources are available offline after sync under
`reference/bittorrent.org/beps/`. Prefer them to the older converted copies in
JSTorrent.

Do not vendor, import, or commit reference source merely for convenient
reading. The ignored checkouts are not RSTorrent dependencies.

Reference implementations do not determine RSTorrent architecture. Follow the
policy in [`docs/references.md`](docs/references.md) before adapting source,
fixtures, or test data.

## Android Release Automation

[`docs/android-release.md`](docs/android-release.md) owns the production
candidate tag/version workflow, pinned Android toolchain, signing setup, and
artifact checks. `clients/android/build.sh release` builds the signed APK/AAB
and runs release JVM tests and lint when signing environment variables exist.


## Dependency And Package Review

Desktop package/release overlays and Android builds require pinned
`cargo-about` for dependency attribution before packaging:

```bash
source ~/.profile
cargo install cargo-about --locked --version 0.9.2 --features cli
python3 scripts/prepare-release-notices.py --target aarch64-apple-darwin
python3 -m unittest discover -s scripts -p test_distribution_review.py
python3 -m unittest discover -s scripts -p test_linux_native.py
python3 scripts/inspect-distribution.py --root target/release/bundle/macos/RSTorrent.app --output artifacts/distribution/macos.json
```

Use the target actually being packaged; Tauri's before-build hook supplies it.
Linux AppImages additionally require the reviewed
[native source builds](distribution/linux-native/README.md). Build them in a
fresh owned Ubuntu24.04 directory and set `JSTORRENT_LINUX_NATIVE_BUILD` before
Tauri bundling. The output hook replaces the two libraries, records their exact
source/patch provenance and rejects the known GPL-only runtime chains before
signing. After extraction, add `--require-native-notices --require-mit-native`
to `inspect-distribution.py` for new Linux candidates. Historical images remain
reviewable without the new MIT packaging flag.
Generation fails on missing/unreviewed license evidence. The resource manifest
records lock hashes and the exact notice hash. Native platform libraries and
Android Maven/AAR packages have separate notice graphs. Tactical `217` adds
variant-owned Android assets for the exact Maven/AAR and both-ABI Rust graphs.
The public AGP generated-assets API owns their output locations; do not write
to a guessed directory. `clients/android/build.sh` checks the generator version
before native builds and verifies notices in its final APK. Direct Gradle
packaging also runs generation. Source and parent POM changes require fresh
attribution, so these small metadata tasks run each time they are requested.

```bash
clients/android/gradlew --project-dir clients/android :app:prepareReleaseNotices
python3 -m unittest discover -s scripts -p 'test_*android*.py'
python3 scripts/inspect-android-notices.py --archive clients/android/app/build/outputs/apk/debug/app-debug.apk --variant debug
```

Release asset generation needs no signing credentials; creating release APKs
and AABs still requires the existing signing setup. Signed release inspection
checks both archives' notices and native library inventory. Native input
hashes identify the published AARs; AGP strips native files before packaging,
so these are not claims of byte identity with final APK library contents.

For advisory review, install `cargo-audit --locked --version 0.22.2`, collect
`python3 scripts/audit-cargo-dependencies.py --output FILE` and
`npm audit --prefix clients/web --json` and
`npm audit --prefix website --json`, then pass those reports to
`scripts/review-dependency-audit.py --cargo FILE --npm FILE --website-npm FILE
--output FILE`. The weekly workflow rejects new vulnerabilities, changed
warnings, stale databases and expired reviews. `--require-release-ready`
also rejects the explicit blocker list and is required by tagged publication.
The approved GLib 0.18.5 backport is active Cargo source. Check its exact
published-source provenance and two-line delta with
`python3 scripts/glib_backport.py`; run negative integrity/attribution cases
with `python3 -m unittest discover -s scripts -p test_glib_backport.py`.
On native Linux, run
`cargo test --locked --release -p rstorrent-desktop --test glib_backport`.
Both native Linux package lanes require that optimized regression. Do not
modify the vendored crate without updating and reviewing its provenance.
The audit collector restores the original GLib registry identity only in an
in-memory audit projection, retaining detection of future advisories. Review
requires that projection to match the current lock and verified backport.

Physical Tactical 253 runners use explicitly selected Machine Control targets
and isolated owned state:

```bash
uv run --project tests/interop --locked python tests/interop/chromeos_android_qualification.py --help
uv run --project tests/interop --locked python tests/interop/chromeos_android_recovery.py --help
uv run --project tests/interop --locked python tests/interop/chromeos_crostini_qualification.py --help
PYTHONDONTWRITEBYTECODE=1 uv run --project tests/interop --locked python -m unittest discover -s tests/interop -p test_chromeos_qualification.py -v
```

Preflight the controller's explicitly selected seed TCP ports from the target.
The Android runner requires the qualification APK installed in its separate
package. The Crostini runner requires the exact package staged in its owned
root and an isolated running gateway; it reports runtime coverage separately
from installation/launcher/browser acceptance. Both use controlled payloads,
three repetitions and a bounded 60-minute observation. Android runs use unique
metainfo names to prevent concurrent owned devices sharing a swarm; hour
fixtures are bounded at 40 MiB, short fixtures at 28 MiB. `--completed-upload`
requires background mode and a nonzero observation; it selects actual native
seeding/listener controls, verifies an independent leecher and waits for joined
shutdown followed by the restored Live library. The SAF recovery runner also
accepts optional `--registry` for runtime-private inventory and preserves
production installations. Short observation runs
leave endurance open. External teardown must uninstall only the owned APK,
stop/remove the owned Linux runtime, restore initial VM/window state and remove
only owned temporary transport exceptions. See Tactical 253 for current limits.
