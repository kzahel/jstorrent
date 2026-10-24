# Tactical 242: Legacy Desktop Handoff And Rehearsal

Status: **Complete bounded macOS checkpoint, 2026-09-30.**

Owners: `desktop-jstorrent-replacement`, `client-surfaces`,
`application-connection-architecture`, `capability-readiness`, campaign 231.

## Outcome And Stopping Condition

Close the released desktop host's ordinary launch routes before invoking 241.
Qualify one installed macOS replacement with generated source state, then
record platform and production-release limits. Stop with production-only
registration/refusal, quiescence checks, repeatable isolated rehearsal evidence
and repository validation committed. No personal profile is migrated.

Dependencies: 241's atomic import; 232's installed helper/control owner;
233's released writer provenance; 236/237's terminal compatibility contract.

Non-goals: public release/store upload, updater-key or incubation identity
changes, arbitrary old executable revocation, a raw-IO bridge, Android import,
broader source releases, complete settings parity or automatic rollback.
Privacy/background/seeding-policy dispositions remain recorded graduation
work; this slice does not silently broaden the importer mapping.

## Contracts And Bounds

- Only `com.jstorrent.desktop` may take over `com.jstorrent.native`. Incubation
  keeps its existing name and never overwrites legacy registrations.
- The legacy name targets a copy of the existing helper in refusal-only mode.
  Every framed request returns a released-format failure and update guidance;
  no launcher, listener, daemon, KV writer or application capability is created.
  Caller allowlisting, 64-KiB frames and 64-byte IDs remain bounded.
- Cover the released Chromium browser families, current test-browser paths,
  Windows registry views and the released Linux AppImage stable-host copy.
  Registration failures stop production startup before catalog/payload work.
- Registration precedes same-user old-process refusal, including old hosts
  waiting for their first handshake. Source liveness remains 241's second gate.
  Process checks are bounded, read-only and never kill unrelated processes.
  Existing OS APIs/dependencies own platform inspection; no coordinator added.
- Package replacement owns old installed sidecars. Normal managed launch paths
  are fenced; manually retained old applications/binaries remain unsupported.
- Source snapshots and payload stay unchanged. Retry may encounter the already
  installed refusal; it repairs idempotently. Completion never reimports.
- Test only a claimed guest and generated profiles. Preserve inherited app,
  registration, profile, browser and power state; restore it and release claims.

## Source Review And Ownership

Chrome's native-messaging manifest/protocol documentation defines the named
host lookup, exact origins, framed stdio and retained `connectNative` process:
https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging

Released JSTorrent `73427b7d3aef2eaf1c4ac1409922fbb52dff751d`:
`desktop/tauri-app/src-tauri/src/native_host.rs` registers the legacy name for
seven macOS/four Linux Chromium-family roots and four Windows HKCU browser
keys; AppImage copies `jstorrent-host` to the user's stable library directory.
`desktop/host/src/{main,protocol,daemon_manager}.rs` starts RPC before handshake,
defers discovery/KV/daemon activation until handshake, and owns daemon stop.
Therefore discovery-port checks alone miss already-open pre-handshake hosts.
The legacy response is `{id,ok:false,error,type:"Empty"}`. Refusal deliberately
implements no operations, authority or compatibility bridge. Reference source
is studied, not copied. 241 owns the unchanged engine/storage oracle record.

Desktop startup owns registration and invocation order. The existing native
helper owns bounded refusal frames and read-only platform process inventory.
Temporary process-inspection work is joined with a deadline and cancellation;
no long-lived runtime task is added. Engine, protocol values, Android and
application DTOs remain unchanged; Android handoff is inapplicable here.

## Validation

Deterministic/process tests: refusal framing for handshake/takeover/KV/modern
requests, no launch capability, unauthorized/malformed/oversized input, exact
production gating, legacy browser coverage, idempotent registration repair,
stable-copy replacement, source-preserving failure and same-user idle old host.

Installed macOS rehearsal: checksum-pin released package/binaries; generate
source state through released native KV operations with independently authored
metainfo; preserve roots/run/selection and mapped settings; stop old host; replace the
same bundle identity/path with an unsigned local candidate. Prove stale native
requests refuse, migration/checking/restart/missing-root behavior, completion
idempotence and source/payload preservation. Test a live pre-handshake host and
registration failure. Use semantic UI/command-driven hooks before screenshots.

Run fmt, workspace clippy/tests, native-helper process tests, desktop build and
relevant script checks. No shared web or application contract change is planned.
Record exact artifacts, commands/results, cleanup and unqualified paths below.

## Implementation And Evidence

The private versioned helper selects refusal by its retired executable name,
before consulting launch configuration. It also replaces an existing bounded,
same-user Linux AppImage stable-host copy. Mac/Linux manifests cover the
released browser families plus test-browser roots; Windows covers both HKCU
registry views. Deterministic registration tests prove incubation isolation,
repair, coverage and refusal of an unsafe AppImage symlink.

Unix inventory owns one `/bin/ps` child and reader, with a five-second deadline
and 1-MiB output ceiling. Windows uses owned ToolHelp/process/token handles,
same-user SID comparison, 32,768 entries and a 64-KiB token ceiling. Only the
inventory's own child may be killed on timeout. Production checks after
registration and again before opening the application service. No old client is
terminated by product code.

Installed failure testing exposed the previous `blocking_show` calls on
Tauri's setup/main thread, leaving application AX unresponsive while the
system-owned alert was pending. The dialog plugin explicitly forbids its
blocking API on the main thread. Startup errors now queue an asynchronous dialog
and
return with no application owner; dismissal exits with status 1. Exit handling
allows that ownerless path. The normal macOS menu is installed after state
exists, and import warnings are asynchronous. The installed dialog text and
native Quit actions were exercised through Machine Control's semantic AX route.

The checked-in driver is
`tests/interop/legacy_desktop_replacement_rehearsal.py`. It requires an explicit
isolated guest, a new absolute root and checksum-pinned archives. The common
Machine Control CLI owns guest administration and UI operations; the driver
owns only product-specific generated data, children, assertions and restoration.

Artifacts (SHA-256):

- Released `JSTorrent_aarch64.app.tar.gz` from
  `tauri-app-v0.2.1`:
  `4bc5e979635fe9283d9ba60e43f86bfadcf619adf546cdbe4b68b27d424343f1`.
- Released desktop:
  `f008e2d00e7e414e16096d1ea319d870807ddeddb25d459740b01a0727b019e7`;
  host: `cc5faaefa59e72d6ac098251ea7cc7c9ec90b35711c342a1211faa01e04a0411`;
  daemon: `57b77c713f4f6b09c955f73694bd3dce7731042093d215e1ec64871d15f88f56`.
- Local unsigned debug candidate archive:
  `f33c7d03c2b742120b984a6bd88456713a717d996a22c9b3f600f547c0e17500`;
  desktop binary:
  `a570c95313ad8eedee52adb08f3038f86b63fd50ec29b715dbec1953a72e277a`.

The candidate uses a temporary, uncommitted Tauri overlay selecting JSTorrent
name/title and `com.jstorrent.desktop`, with updater endpoints disabled. Build
from `clients/desktop`, after sourcing the shell profile:

```bash
../web/node_modules/.bin/tauri build --debug \
  --config src-tauri/tauri.package.conf.json \
  --config /absolute/path/to/local-rehearsal-overlay.json \
  --bundles app --no-sign --ci
```

The overlay replaces the main window list with the existing `main` label,
`create:false` and current dimensions. Package the resulting `JSTorrent.app`
with `COPYFILE_DISABLE=1 tar -czf ...` to exclude macOS resource-fork entries.
Transfer that archive, the pinned release and both rehearsal/cohort Python
drivers into the claimed guest. Run with `--isolated-guest`, a new `--root`,
`--legacy`, `--candidate` and `--candidate-sha256`. Observe `phase.json` and use
native Quit/OK actions at the phases described in the driver's docstring.

Final installed run: **passed**. Two released-host profiles contain four
stopped records: intact and subsequently corrupted one-piece files, unavailable
root content and a pending magnet. Released GUI/native host/daemon open and
join before replacement at the same bundle path/identifier. Both files retain
foreign `80` completion claims before import. Results:

- A real pre-handshake old host and a controlled manifest-directory failure
  each show a native error and exit before any catalog exists. Legacy state is
  preserved; retry repairs registrations.
- Four records import, with zero skipped/already-present. Ordinary checking
  persists one verified intact piece, zero corrupt pieces and zero missing-root
  pieces. All intent remains paused; the pending magnet has no trusted metadata.
- The unavailable directory is never recreated. All payload hashes match the
  baseline taken after intentional fixture corruption/disconnection.
- Every one of nine installed browser-family legacy manifests points to an
  executable returning only the exact released failure envelope and update
  guidance. This probes actual registered executables, not a browser-store pair.
- Native Quit joins the owner. Restart preserves all four torrent IDs, checker
  results and the single completion marker. Discovery, logical KV, main database
  bytes and nonempty WAL bytes remain unchanged.

SQLite can initialize empty WAL/SHM files even when opening a main database
read-only. An initially stricter oracle rejected newly created zero-byte WALs;
comparison proved unchanged database/KV/discovery data. The final oracle allows
empty WAL creation and transient SHM bookkeeping, while comparing original
database and nonempty WAL bytes. Closed driver snapshots copy main+WAL into a
private directory before
inspection, so the oracle never initializes source SHM. An initially malformed
pending-magnet fixture was correctly skipped; the final source follows the
released shape, with no file priorities before metadata.

The native shared React view connects and shows its fresh installation privacy
disclosure. Source installation/privacy continuity and complete production
branding remain explicit graduation work; this run does not acknowledge or
migrate privacy choices, nor claim a rendered-library workflow qualification.

Validation actually run:

- `cargo fmt --all -- --check`.
- `cargo clippy --workspace -- -D warnings`.
- `cargo test --workspace`: 1,558 passed, 18 ignored, zero failed across 70
  reported suites. Focused native-host tests: 21 unit and three process cases;
  desktop tests: 60 passed (including nine registration cases).
- `cargo check -p rstorrent-native-host --target x86_64-pc-windows-msvc`.
- The packaged desktop build above, including web build/CSP/generated-output
  checks; no tracked web/generated contract files changed.
- Python `py_compile`, `--help` and the installed driver.
- `env -u TAURI_CONFIG cargo build -p rstorrent-desktop` restores the ordinary
  incubation executable after local production-identity packaging.

The Linux target's read-only doctor could not establish its configured identity,
so no Linux guest was mutated. macOS was claimed, resumed from suspension, and
used only for generated source state. The driver restored inherited app,
registration, profile and browser scopes, with empty restoration backups; all
owned artifacts/processes/dialogs are removed, the guest is suspended again and
the claim released. No personal profile, store publication or update occurred.

## Remaining Qualification

Windows/Linux installed legacy replacement, actual production/store extension
pairs, signed JSTorrent updater/installer delivery, minimum/Intel macOS,
interrupted replacement and active-payload rollback remain open. Manually
retained old executables are outside managed-route fencing. Settings/privacy,
background/seeding and support-report dispositions, complete branding and
extension/Android release order remain campaign decisions. 231 Rehearsal B is
partial; this checkpoint is not production graduation.
