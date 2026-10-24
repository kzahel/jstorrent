# Tactical 232: Desktop Extension Control

Status: **Linux/Windows/macOS installed checkpoint complete, 2026-09-29.**
Protected bootstrap, extension-owned native picking, controlled transfer, shared
library, singleton and joined Quit pass on all three installed debug packages.
Tactical [234](234-desktop-user-intent-and-background-lifecycle.md) adds the
bounded cross-platform intent/tray, detached-transfer, reload/worker/discard
and subscription-cleanup checkpoint. Full Rehearsal A remains partial: broader
endurance, OS/browser suspension and update compatibility remain open. This is not production release readiness.

Parent: [`231-jstorrent-migration-working-campaign.md`](231-jstorrent-migration-working-campaign.md)

Topics: `desktop-jstorrent-replacement`, `product-surfaces-and-migration`,
`application-connection-architecture`, `runtime-configurations-and-headless-deployment`,
`client-surfaces`, `web-ui-design`, `application-view-api`,
`download-root-acquisition`, `product-state-and-feedback`, `capability-readiness`.

## Outcome And Stopping Condition

The beta extension opens the mature shared React UI and controls the installed
RSTorrent desktop app's existing Rust application service. An extension-first
cold launch does not force the native main window open. Opening that window
later attaches to the same library. Neither switching views nor closing the
browser transfers engine ownership.

There is one desktop library. Multiple browser profiles or authorized extension
installations create client connections, not desktop profiles. No profile
create/select/switch or takeover operation belongs to this slice. Internal
backend/profile identity remains useful for stale-connection validation only.
Legacy profiles will be unioned by the separate importer, not represented as
selectable backends in this UI.

Stop after Rehearsal A in Tactical `231` passes on installed macOS, Windows and
Linux packages, with exact beta-extension identity, controlled byte integrity,
two-view convergence, picker behavior, detach/reconnect, admission failures,
resource bounds and joined shutdown. Record partial platform progress honestly.
This slice uses fresh test profiles; legacy import and production publication
remain later campaign gates.

## Accepted Launch And Connection Rules

Maintainer accepted the simplified model during the migration discussion:

- Clicking the extension opens/focuses its browser UI and starts or attaches
  to the sole desktop runtime without forcing its native window open.
- Ordinary desktop launch opens/focuses the native window on that same runtime.
- Both views may coexist. There is no preferred-UI setting, takeover prompt,
  automatic closing of the other view, or browser-owned data authority.
- Desktop connection setup should be automatic through the installed approved
  native-messaging integration, without routine code-entry pairing. The selected
  protected bootstrap and credential contract is recorded below; finding a
  port or checking Origin alone is insufficient.
- Reconnect may attach to a running/restarting owner, but must never start a
  stopped runtime on its own. Only explicit user open/start requests may launch
  it. Explicit Quit leaves the extension disconnected with a Start action.
- Preserve native close/background policy. Desktop shell actions such as
  notifications and manual update checks retain their existing native routing
  initially; adding remembered presentation preference is outside this slice.

Maintainer follow-up makes the launch/lifetime rules explicit in
[Tactical 234](234-desktop-user-intent-and-background-lifecycle.md): retain the
tray whenever the desktop runtime runs, browser closure only detaches, and
fresh toolbar/Start/OS torrent-input intent can relaunch after Quit. Tray Open
and OS inputs always use the native window, with no browser-profile routing.

## First Implementation Checkpoint

Build one vertical path: **click extension -> ensure one desktop runtime ->
authenticate -> display its library -> pause/resume a test torrent**. Reuse the
existing React application and native service. This is an intermediate gate
within this tactical, not its full cross-platform stopping condition.

Implementation order:

1. Separate explicit desktop-window activation from background start/attach
   intent in the singleton launch path. Race-test simultaneous requests and
   make automatic reconnect attach-only so it cannot undo explicit Quit.
2. Close and implement the protected bootstrap/authenticated connection contract
   with a typed ready response and bounded failure states. Authenticate and
   validate backend/protocol identity before exposing library state.
3. Open/focus the extension's packaged React page on that connection. Use a
   controlled fresh library/root prepared through the existing native UI for
   this first checkpoint; native picker from the extension follows next.
4. Prove cold launch without a forced native window, warm attachment, the same
   library from two views, pause/resume convergence, repeated-click singleton
   behavior, invalid-credential refusal and Quit without automatic resurrection.

Use deterministic/scripted checks first, followed by a claimed installed
rehearsal through Machine Control. The recommended development loop is a native
Linux x86_64 builder and a matching Linux VM, subject to a successful guest
readiness check; the previously ready macOS VM is a fallback and subsequent
platform gate. Then add extension-driven folder selection,
magnet/metainfo intake, full lifecycle/failure coverage and remaining platform
installed gates. Do not infer migration readiness from this first checkpoint.

## Build And Test Placement

Prefer incremental Rust/web builds on a Linux development controller with a
retained build cache, then transfer the exact application bundle/native host
and packaged extension to its claimed Linux VM. Matching architecture avoids
cross-compilation but does not prove library compatibility: verify the guest
ABI/dependencies and package launch. If those differ, use a compatible build
environment or build inside the VM. Later package gates exercise the actual
installer rather than only copying a development executable.

Keep installed-host registration, test browser, profiles, associations and
lifecycle experiments inside the VM. Use deterministic tests on the builder
and target-native Machine Control operations for guest evidence. Source transfer
must preserve unrelated remote work, identify the exact tested snapshot, and
avoid copying build caches between architectures. An agent may coordinate from
another host over SSH; moving its session into the VM is unnecessary.

The 2026-09-28 read-only alternate-controller survey finds native Linux Rust,
Node via NVM, GTK/WebKit development dependencies and an existing build cache.
Linux/Windows VM routes resolve there but both guests are off; no running-guest
readiness is claimed. Concrete controller selection remains private inventory.
Before use, doctor, claim, start through the common CLI and verify resident
readiness; retain inherited power state and release claims after cleanup.
Qualify macOS separately through its Apple-hosted VM and Windows through its
native target; Linux success does not cover those launch/IPC/picker paths.

## Existing Seams To Reuse

Reviewed in the current working tree at RSTorrent HEAD
`7a4d7730920f84ed0c02374506b0cd4af1f26f2d`:

- `clients/extension/src/service-worker.js`: typed native `hello`/`launch`,
  platform-specific open/focus and remembered extension tab lifetimes.
- `crates/rstorrent-native-host/src/lib.rs` and `tests/process.rs`: bounded
  stdio bootstrap and configured platform launcher. It owns no profile.
- `clients/desktop/src-tauri/src/{lib,desktop_lifecycle,native_host_registration}.rs`:
  application owner, single-instance/window/tray/shutdown and host registration.
  Root selection currently requires a `WebviewWindow` parent. A windowless
  launch is a concrete missing platform seam, not just another launch flag.
- `clients/web/src/{companion-main,android-companion-client}.ts` and
  `inspection/companion-bootstrap.tsx`: packaged React mounting, backend identity,
  transport/platform adapter and disconnect recovery. The current mount hardcodes
  `one_current_root`; do not silently impose Android presentation policy on
  desktop while sharing it.
- `crates/rstorrent-gateway/src/chromeos_companion.rs`: bounded identity/pairing,
  platform requests and application-connection composition. Its ARC address and
  Android trust model must remain platform-specific.
- Tacticals `162`, `166`, `194`, and the connection/runtime/root-acquisition
  topics: lifecycle, host bounds, tested Android pattern and native picker gaps.

Reuse the application client/reducers and authenticated connection machinery
where ownership fits. Extract a concrete shared mount or connection component;
do not fork the UI or add a generic backend/plugin framework. Keep new desktop
bootstrap/lifecycle policy out of protocol and engine crates.

## Scope And User Journeys

1. Desktop popup open/focus presents the extension UI. Keep an explicit action
   to open the native window. Show actionable missing-app, incompatible-version,
   stopped, connecting and disconnected states without displaying raw endpoints
   or profile IDs as routine product guidance.
2. Native messaging locates or starts the existing desktop singleton and
   establishes narrowly scoped extension control. Concurrent cold launches
   converge before a second application service or profile is constructed.
3. The extension uses ordinary semantic commands/views for add, file selection,
   pause/resume, queue, recheck, keep-data/remove, settings and inspection.
   Bounded metainfo attachment remains distinct from torrent payload IO.
4. Root choose/repair runs in the desktop OS. The extension receives the root
   snapshot, never ambient filesystem capability. Test no-window parenting,
   cancellation, foreground activation, disconnect and app shutdown.
5. Native and browser views converge after commands from either. Closing or
   suspending a view releases its leases; reconnect obtains authoritative state.
   A lost reply is not permission to replay a destructive command blindly.
   Two authorized browser profiles must also see the same desktop library;
   neither may cause another catalog to be created or selected.
6. Desktop shell owns background policy, native notifications, updater and Quit.
   The extension cannot become necessary to keep the engine alive. Preserve
   existing native-window close semantics or explicitly settle any change.
7. Provide bounded connection/backend diagnostics and an accessible report
   action. Never record bootstrap secrets in URLs, command arguments or logs.

Core torrent control is the first slice. Before claiming full legacy workflow
parity, inventory media/open-file actions, magnet interception, context menus,
search/plugins and per-presentation preferences. Unsupported capabilities must
be hidden or explained accurately and tracked in Tactical `231`; silently
inheriting Android's no-media capability profile is not desktop parity.

## Transport Design Checkpoint

Selected composition (detailed contract and evidence below): a thin native-messaging bootstrap plus
an authenticated loopback semantic connection hosted by the existing desktop
process, reusing the WebSocket application client. It must not instantiate a second gateway
application service or reuse the media-only listener as ambient control access.

Compare with carrying semantic frames over a persistent native-messaging
bridge to local IPC. Evaluate binary metainfo attachments, frame amplification,
backpressure, service-worker lifetime, OS IPC authentication, packaging and
maintainer complexity. The existing host's 64-KiB bootstrap limit and the
application's larger binary attachment path cannot simply be conflated.

Before coding the chosen transport, record exact official Chrome native-
messaging, MV3 lifecycle/CSP/network-permission documentation and locked Tauri
single-instance/window/dialog source and tests. Resolve:

- how the bootstrap proves the installed owner and same-user caller, including
  protected local rendezvous/IPC and malicious port prebinding;
- endpoint selection, binding, exact extension-origin/Host checks, browser
  permission/CSP scope, and proof that another LAN host cannot control it;
- credential delivery, lifetime, storage, revocation and restart rotation;
  Origin validation alone is not authentication;
- backend/profile/protocol identity and behavior on stale state or skew;
- native-host EOF, handshake deadlines, retry/backoff and cancellation;
- per-connection and global limits for views, queues, outstanding calls,
  attachment buffers, concurrent clients and bootstrap work; and
- shutdown ordering and explicit handling of authentication failure versus
  ordinary temporary connection loss.

Retain current semantic frame/attachment limits unless a separately justified
contract change is needed. Set numerical control-specific bounds before the
implementation checkpoint closes; no unbounded queues or pending requests.

## Owner And Cancellation Map

| Owner | Responsibility | Termination |
| --- | --- | --- |
| Extension worker | Open/focus and short bootstrap work | Worker suspension is tolerated; it owns no engine or persistent view subscription |
| Extension React page | One client connection, reducers and view leases | Page close/abort releases connection and pending work; fresh page recovers state |
| Native host | Validated launch/rendezvous or chosen bounded bridge | EOF/error/deadline closes owned resources; desktop survives presentation detach |
| Desktop shell | Singleton, optional window, tray, updater and control owner | Existing joined Quit/restart path stops admission and joins child owners |
| Desktop control owner | Credentials/connections/platform requests around the existing service | Revocation closes admitted clients; shutdown cancels and joins pumps and picker requests |
| Application service | Existing profile, commands, views, engine and storage | Existing supervised shutdown; no browser lifetime dependency |

Dependency direction: presentation and desktop/transport adapters depend on
the common semantic application boundary; protocol/domain state does not depend
on Tauri, browser runtime, sockets or the native host. Avoid growing desktop
`lib.rs` with a second independent connection/authentication subsystem; extract
the new owner at its actual lifetime boundary.

## Lifecycle Decisions To Close

- Implement genuinely windowless cold startup where feasible; a hidden but
  instantiated webview must be reported as such, with its observer cost.
- Determine how extension requests raise a native folder picker without forcing
  the product window and how unavailable desktop sessions fail visibly.
- Specify behavior when background mode is disabled, the last extension page
  closes, or a native window closes while an extension remains attached. Preserve
  ordinary close behavior; do not invent browser-driven engine termination.
- Keep existing native notification/update routing without a preferred-view
  setting. Verify it remains reachable from extension-first startup and retains
  one updater and notification authority without duplicate prompts.
- Distinguish explicit Quit, restart for update and transient disconnect, with
  reconnect limits and truthful recovery messages.

## Implementation And Validation Order

1. Close the design checkpoints with source-backed contracts, exact bounds and
   deterministic state tests planned. Record the capability disposition matrix.
2. Implement native start/attach plus authenticated hello against a fresh
   in-process service. Prove singleton races, invalid credentials, stale owner
   identity and cancellation before connecting the full UI.
3. Connect the shared React application and native folder capability. Prove
   two-view convergence, metainfo attachment, one controlled transfer and exact
   hashes through the headless/scripted harnesses first.
4. Exercise browser suspend/restart, socket loss, slow consumers, revoked access,
   malformed/oversized input, picker interruption and joined shutdown. Measure
   idle detached observer cost and active resource peaks.
5. Run installed Rehearsal A through Machine Control on each desktop platform.
   Test packages/registration, picker focus, cold launch, tray and update restart
   using target-native observations. Use the test browser, not a temporary
   profile under the user's primary browser identity.
6. Run existing extension platform-routing/package tests and Android companion
   tests after shared changes. Rebuild generated/native boundaries if changed;
   require physical ChromeOS evidence for changes to shared pairing, permissions,
   launch, root or service-lifetime behavior.

Planned baseline: `cargo fmt --all -- --check`,
`cargo clippy --workspace -- -D warnings`, `cargo test --workspace`, web
typecheck/tests and applicable browser E2E, extension tests/package, and native
desktop builds. Run the narrower harnesses first; record exact commands and
results as execution occurs; the execution records below supersede the original
plan's untested status.

## Non-Goals And Completion Record

No legacy importer, production-extension replacement, app rename, release,
remote/LAN control, browser-owned engine, raw IO daemon or separate desktop
service. Public remote authentication work is independent. Android keeps its
existing same-device boundary; Crostini remains its separate backend.

Completion evidence: the first Linux control checkpoint is verified below.
Continue installed picker/package and controlled-transfer evidence on Linux
and Windows, keeping macOS and broader campaign gates open.

## First Checkpoint Contract (2026-09-28)

### Next Linux and Windows checkpoint (2026-09-29)

Execution is authorized on the Linux builder and claimed Linux/Windows guests;
macOS acceptance is deferred. Preserve the first checkpoint's single runtime,
library, exact beta origin, attach-only reconnect and ephemeral credentials.
Implement and verify Windows bootstrap before advancing picker ownership,
controlled transfer and real installer/registration acceptance. Legacy fixture
preparation belongs to M-02; this tactical still does not implement an importer.

Windows bootstrap uses one overlapped, byte-mode named pipe per OS user and
native-host directory. Its name is a SHA-256 digest of that directory and the
user SID, not a bearer secret. The server specifies its owner and a protected
DACL granting only that SID access, rejects remote clients, and requests the
first pipe instance with a two-instance ceiling: one exchange and one pending
accept. A replacement is created before the previous handle closes, preserving
name ownership. Replacement retries a busy kernel slot within one second while
IOCP completes destruction of the previous handle. The
client checks the connected pipe's owner SID before reading credentials and
uses identification-only security QoS. Same-user arbitrary code and privileged
administrators remain outside this boundary, as on Linux.

Reuse the 4-KiB ready frame, one-second exchange deadline and explicit startup
deadline. Windows adds a one-byte acknowledgement before server disconnect so
buffered credentials are not discarded before the client reads them. A busy
pipe is retried only inside the exchange deadline; it is never evidence that
the app stopped. Cancellation closes the overlapped pipe and joins its task.
No rendezvous file containing credentials, additional service or daemon.

Official references reviewed: Microsoft [CreateNamedPipe](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea)
(first-instance admission, overlapped operation, remote rejection),
[GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo)
(named-pipe owner queries require READ_CONTROL; returned descriptor ownership),
and locked `tokio-1.53.1/src/net/windows/named_pipe.rs`
(`ServerOptions`, security attributes, `ClientOptions` identification default,
disconnect). Native Windows races exposed retained overlapped-read state when
reusing a handle and delayed kernel-instance retirement after closing it. Use
fresh handles, wait for client EOF after the acknowledgement, and bound
replacement retries. Native source tests cover framing, timeout, busy
admission, owner refusal, duplicate bind and joined shutdown. Installed Windows
evidence remains open until the actual guest passes the lifecycle matrix.

Windows native-host evidence (2026-09-29): the claimed Windows 11 x64 guest
passes `cargo test -p rstorrent-native-host` (12 unit, two process tests),
including 12 simultaneous bootstrap callers, duplicate-owner refusal, owner
SID mismatch, busy/timeout handling, oversized frames and joined shutdown.
Native guest Clippy with tests and `-D warnings` passes. Linux native-host
tests (12 unit, two process) and Windows cross-target Clippy also pass.
This qualifies the bootstrap primitive; desktop/browser installation and
lifecycle integration remain the next evidence gate.

Picker contract: use a desktop-only platform frame on the authenticated semantic
connection, containing a call ID and optional opaque repair-root ID. It is not
an engine command and cannot supply a path. Return only the existing root
snapshot or Cancel. Other runtime compositions refuse this frame. No Android
pairing, permission, picker or service behavior changes.

The desktop owns one picker permit across native and extension views. Repeated
or concurrent requests return busy rather than queueing hidden dialogs. The
extension picker uses a short-lived child invocation of the same executable,
before singleton/Tauri/application setup, exclusively to run the pinned native
`rfd 0.16.0` folder dialog. This is a dialog helper, not another runtime, service
or data owner. Its private standard pipes carry a bounded starting-directory
request and selected path; neither reaches JavaScript. Keep the native view's
existing parented dialog while sharing admission with the extension picker.

This process boundary is deliberate: locked `rfd` GTK `GtkDialogFuture` and
Windows `ThreadFuture`/`IDialog::show` do not close their dialog when the caller
drops its future, and Tauri's callback API exposes no cancellation handle.
The helper lets the parent close and reap exactly its dialog on connection
loss, cancellation, a five-minute deadline or Quit, without platform-specific
cross-thread window destruction. No child is detached; the permit is retained
until the child exits and is reaped. Quit closes admission and joins picker
ownership before application shutdown. Input and output are capped at 16 KiB;
the selected UTF-8 path retains the platform's 4-KiB bound. A failed helper is
an error, not a successful Cancel. Linux uses the existing GTK3 backend;
Windows uses the existing Common Item Dialog. macOS helper activation and
focus remain unadvertised until its future acceptance session.

Picker implementation builder evidence (2026-09-29): desktop helper tests
prove disconnect/Quit kill and reap the owned child before readmission, and
reject malformed output, nonzero exit and deadline expiry. Authenticated gateway
tests cover selection, Cancel, healthy-root repair refusal and disconnect
without root installation. Web tests cover platform capability refusal, normal
Cancel retaining the connection and abort closing the requesting connection.
Web typecheck and suite pass (409 pass, two skipped); extension suite passes
(34 tests), packaging and localization checks pass. Workspace Clippy passes.
The first full workspace test run hit the existing engine corrupt-generation
two-second peer timeout under concurrent builds; its focused rerun passes.
The full rerun with `--test-threads=2` passes: 1,528 tests, 18 ignored. An independent application lifecycle
smoke also timed out at repair completion (two of three pieces); it is not
claimed as passing transfer evidence. Installed acceptance follows separately.

Chosen composition: short native messaging bootstrap, protected local Unix
rendezvous, then the existing semantic WebSocket adapter inside the desktop
process. No second ApplicationService. A persistent native bridge was rejected
for this checkpoint: Chrome's 1-MiB native response limit would require a new
fragmentation/backpressure protocol for existing 16-MiB semantic responses and
64-MiB metainfo attachments, and would tie transport to another process.

Official sources inspected:

- https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
  (exact origins, caller argument, native-endian framing, per-message host,
  1-MiB output/64-MiB input; retain our smaller 64-KiB bootstrap limit).
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
  (worker suspension; the page owns the connection, never the worker).
- https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
  and https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
  (packaged code, exact loopback connect scope, host permissions).
- Locked registry source: `tauri-plugin-single-instance-2.4.3/src/lib.rs` and
  `src/platform_impl/linux.rs`: plugin setup claims the non-replaceable session
  D-Bus name before user setup; secondary launches forward argv then exit.
  The published crate contains no singleton integration tests. Repository
  `desktop_lifecycle.rs` and native-host `tests/process.rs` provide local seams;
  simultaneous installed launches must supply the missing runtime evidence.
- `tauri-2.11.5/src/app.rs::setup` creates only windows with `create=true`;
  `WebviewWindowBuilder::from_config` supports later explicit construction.
  `tauri-plugin-dialog-2.7.2/src/lib.rs::{set_parent,pick_folder}` and
  `rfd-0.16.0/src/backend/gtk3/file_dialog.rs` retain the native GTK picker.
  Picker changes are explicitly deferred; use the existing native window.
- JSTorrent `docs/contracts/native-host-contract.md` and its conformance cases
  require profile allocation/takeover in the legacy host. Deliberate difference:
  this host never selects/creates a profile or owns torrent state.

Linux bootstrap uses a mode-0700, current-UID directory and mode-0600 Unix
socket in the installed native-host directory. Reject symlink/non-owner/insecure
rendezvous objects; validate peer UID. Only the singleton may remove its stale
socket, and only after a refused connection. Bootstrap returns a typed ready
response after the loopback listener has bound. Native messaging additionally
allowlists the exact beta origin for control (legacy hello/launch retain their
existing registration). Same-user arbitrary code execution is outside this
boundary; neither paths nor Origin alone purport to contain it.

The listener binds `127.0.0.1:0`, accepts the exact bound Host and beta extension
Origin, exposes only the semantic connect route, and requires a fresh random
256-bit runtime bearer in the first application frame. No cookie, query token,
static assets, arbitrary HTTP API or LAN binding. Rendezvous authenticity and
bind-before-advertise prevent port prebinding from supplying bootstrap authority.
A stale endpoint/credential cannot authorize a new runtime; credentials rotate
on every process start and are invalidated by joined shutdown. Credentials stay
in native IPC and page memory, never persistent browser storage, URLs or logs.
Windows protected IPC remains unimplemented and fails explicitly; Unix source
sharing is not macOS installed acceptance.

Bounds: four WebSocket clients, five-second application handshake, existing
64-KiB client text, 16-MiB application response plus 4-KiB envelope, 16 pending
calls, eight attachments per connection, 32 control messages, two reserved data
messages, one global 64-MiB torrent upload with its 120-second deadline. Bootstrap
responses are at most 4 KiB; each socket write/read has a one-second deadline;
explicit startup has a ten-second readiness deadline and native host processes
have a twenty-second lifetime ceiling. One worker open operation is coalesced;
one page connection/reconnect loop uses capped backoff and attach-only requests.
Authentication/protocol failure stops automatic retries and offers an explicit
retry. No automatic path launches a stopped app.

Desktop launch intent is explicit: `--extension-background` suppresses initial
webview creation and secondary-window activation. Ordinary launch, tray and
native actions create/focus the main window. Existing close/background policy
is preserved; extension detachment does not decide engine lifetime. Quit closes
bootstrap admission and control connections before the application service.

Capability disposition: shared React library, semantic settings and torrent
control use existing contracts and desktop multi-root presentation. Native root
acquisition, media/open-file, updater and desktop shell actions stay native for
this checkpoint; extension controls must truthfully explain unavailable actions.
No Android trust, pairing, permission or service-lifetime change is intended.

Validation sequence: native bootstrap negative/process tests and control socket
admission/semantic tests; lifecycle tests and desktop build; web/extension tests
and package; installed claimed Linux cold/warm/race/two-view/Quit matrix. Record
exact commands, artifacts, peaks and cleanup below before closing the checkpoint.

### Native implementation checkpoint

Implemented protected Unix bootstrap, loopback-only semantic desktop adapter,
optional webview startup, and control-before-service joined shutdown. The
existing default library remains the sole owner. Windows control fails closed.

Builder evidence so far: `cargo check -p rstorrent-desktop`;
`cargo test -p rstorrent-native-host` (11 unit and 2 process tests);
`cargo test -p rstorrent-native-host -p rstorrent-gateway desktop_control -- --nocapture`
(one focused gateway integration: wrong Host/Origin/token, exact backend identity,
four-client ceiling, library projection and zero active connections after join);
`cargo test -p rstorrent-desktop --lib` (51 pass); desktop/native-host debug build.
Native-host negative cases include insecure/symlink/non-socket rendezvous,
live-owner refusal, stale-socket recovery and bootstrap cleanup. The existing
vendored GLib emits compiler warnings; no vendor source was changed.

### Shared presentation checkpoint

The packaged companion entry now selects desktop explicitly and retains Android
as its default. Desktop uses portable multi-root presentation, an ephemeral
validated bootstrap, the existing WebSocket client, and shared React mount with
proper unmount/close. Folder/media actions remain native-only and the desktop
page offers Open desktop window. Worker clicks coalesce; foreign sender URLs
cannot request bootstrap; credentials never enter remembered-tab storage.

Builder: `npm run typecheck --prefix clients/web`, `npm run test --prefix
clients/web` (403 pass, two skipped), `npm test --prefix clients/extension`
(32 pass), `npm run package --prefix clients/extension`, and
`node scripts/check-localization.mjs` pass. Packaging retains exact beta identity
and permits only exact loopback plus existing ARC network scopes. Installed
Chrome for Testing 151 in the claimed Linux guest reaches the desktop library;
full launch/lifecycle/command matrix is still in progress.

Final resource review also bounds the HTTP phase before WebSocket admission:
eight pending HTTP/1 connections, 32 headers, 16 KiB parser buffer,
and a five-second total HTTP-connection lifetime before upgrade. A joined task set owns these sockets;
Quit cancels it before waiting for application connections. This uses Hyper and
hyper-util already pinned transitively by Axum, now as explicit dependencies.
Reviewed the official [Hyper HTTP/1 Builder](https://docs.rs/hyper/1.11.0/hyper/server/conn/http1/struct.Builder.html)
and [TowerToHyperService](https://docs.rs/hyper-util/0.1.20/hyper_util/service/struct.TowerToHyperService.html)
documentation and pinned `hyper-1.11.0/src/server/conn/http1.rs` defaults; relying on Axum's default
HTTP listener would leave pre-upgrade connection admission unbounded.

Focused final checks pass: eight idle HTTP slots/ninth refusal, five-second
expiry, oversized header refusal and joined Quit with an idle HTTP peer; four
reconnect ownership tests; complete web suite (407 pass, two skipped), web
typecheck/package, native-host tests, workspace Clippy and desktop build.

Installed tab reuse exposed Chrome's redaction of `tabs.Tab.url` without the
broad `tabs` permission. The opener now uses exact own-document
[`runtime.getContexts`](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-getContexts)
(Chrome 116+) to find a live packaged tab, including when its remembered ID is
lost. No broad browsing permission was added. Tests now model redacted URLs
and refusal to focus a navigated-away tab. All 34 extension tests pass; the
fresh Chrome for Testing profile passes 12 repeated opens with one tab, both
with and without a remembered tab ID. Unpacked artifacts are loaded into a
fresh owned test profile after replacement to avoid stale worker code.

### Linux long-profile startup correction (2026-09-29)

The actual deb install exposed `SUN_LEN` refusal when the controlled config
path plus socket filename exceeded Linux's 108-byte pathname field. Linux now
binds/connects the same private filesystem socket through an owned directory
file descriptor under `/proc/self/fd`, preserving directory/socket checks,
peer UID admission, duplicate-owner refusal and cleanup of the original entry.
No cwd mutation, shared temporary socket or abstract namespace was introduced.
Reviewed [unix(7)](https://man7.org/linux/man-pages/man7/unix.7.html) and
[proc_pid_fd(5)](https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html).
A regression exercises a long config path, private socket metadata, live-owner
refusal, ready exchange and joined removal. Other platforms retain their paths.

### Linux first-checkpoint evidence (2026-09-28)

Builder: Linux x86_64, Rust/Cargo 1.97.0 and Node 25.2.0, existing incremental
cache. Guest: Ubuntu 24.04 x86_64, glibc 2.39, GTK 3.24.41, WebKitGTK 2.52.6.
Both sides' ABI and guest `ldd` were checked before execution. Native debug
binaries were stripped for transfer. Native source is commit `3458d66f`;
final extension source is `b4fd802f` (later native changes are tests only).

| Artifact | SHA-256 |
| --- | --- |
| Desktop executable | `29063971072422fd68db5095522bfef4c10ea19f4669b04eb5ba6f753225293f` |
| Native host executable | `bf7f54f48a89bcac9b7ddfb36febc1b70e09ef5d421f43b9ec13adacabd5ff0d` |
| Beta extension 0.4.0 zip | `bb6291fd916f44c771c760e30d285c0d5dc8581241f0f48241ad7f97753f52db` |

The guest used a task-owned development installation layout, isolated HOME/XDG
and fresh library. Its native UI repaired registration and selected the fresh
root through the GTK folder chooser. Chrome for Testing 151.0.7922.34
(Playwright Chromium 1234) used only task-owned profiles. Its custom
`NativeMessagingHosts` directory received the generated manifest, refreshed
after the versioned native-host path changed. This is real native-messaging
and UI evidence, **not** a deb/AppImage installer or registration-update gate.
No ordinary host browser or personal library was used.

The independently generated private torrent has one 4,096-byte piece target,
no tracker, name `checkpoint.bin`, and infohash
`b802168899aecc03c92baafb328d7dff1d529a72`. DHT, PEX, port mapping and listening
were disabled before adding it through the extension's normal file input.
There was no public swarm or byte-transfer claim.

| Check | Exact observation |
| --- | --- |
| Cold extension open | Packaged popup bootstrap started one `--extension-background` process; zero WebKitWebProcess and no forced native main window; library loaded without code entry. |
| Warm attach / same library | Native Open desktop window and a second isolated browser profile saw the same root, torrent ID and infohash. Runtime instance stayed fixed across warm opens; persisted IDs survived restart. |
| Repeated opens | 12 concurrent worker opens retained one companion tab; repeated after deleting only the remembered tab ID. |
| Singleton races | 12 independent native `start_control` calls from stopped state returned one instance; one desktop process and zero native webviews. Eight concurrent ordinary launches subsequently exited successfully into that owner and showed its native window. |
| Pause/resume | Extension React Pause changed native AT-SPI to `Paused 1` for selected `checkpoint.bin`; native Start changed the extension row to Downloading and snapshot `desired_running=true`. Repeated with final native and extension artifacts; final library revision 11. |
| Authentication | Exact hello identity checked before mounting; invalid token and previous-runtime token both returned authentication_failed with no hello/library disclosure. |
| Explicit restart | After the final 35-second stopped observation, the visible Start button connected successfully to one new background process, with no WebKit native window. |
| Quit | Real exported tray-menu Quit action, not process termination; socket removed, zero desktop processes, open extension visibly disconnected with Start after 35 seconds of automatic retries. Repeated on the final artifacts. |
| Resource sampling | Final background process: 84,004 KiB RSS, zero WebKit webviews. With native window: 238,676 KiB process VmHWM, 35 threads. Earlier native run peak 254,764 KiB. These are bounded checkpoint samples, not sustained-load performance claims. |

Reproduce browser assertions with
`node scripts/verify-desktop-extension-checkpoint.mjs PHASE` inside a claimed
controlled guest, setting `RSTORRENT_PLAYWRIGHT_MODULE` to its Playwright module
and `RSTORRENT_TEST_CDP` to its owned browser if needed. Phases: `prepare`, `add`,
`inspect`, `pause`, `resume`, `ui-running`, `native`, `clicks`, `remember`,
`invalid`, `stopped`, `race`, `stale`, `start`. `remember`/`stale` retain the old
credential only in page memory. Native actions use Machine Control snapshots
and current references; tray Quit uses the observed exported dbusmenu action.
The script never launches a controller browser.

Builder validation completed:

- `cargo fmt --all -- --check` and `cargo clippy --workspace -- -D warnings`.
- `cargo test --workspace`: 1,524 pass, 18 ignored, before the final bounded
  HTTP/reconnect refinements; subsequent focused gates below cover those edits.
- `cargo test -p rstorrent-gateway desktop_control`: exact Host/Origin/token,
  four-client high-water, eight HTTP slots/ninth refusal, slow-header expiry,
  oversized-header refusal, shared library and joined idle/active shutdown.
- `cargo test -p rstorrent-native-host`: final 12 unit + two process tests,
  including exact beta control authority versus legacy production hello/launch
  authority, explicit-start versus attach-only intent, protected rendezvous,
  framing/EOF and stdout discipline.
- `cargo test -p rstorrent-desktop --lib`: 51 pass.
- `npm run typecheck --prefix clients/web`; `npm run test --prefix clients/web`:
  final 407 pass, two skipped; four new reconnect ownership cases.
- `npm test --prefix clients/extension`: final 34 pass;
  `npm run package --prefix clients/extension`; `node scripts/check-localization.mjs`;
  `npm run build --prefix clients/web`; desktop/native-host incremental builds.

Next: implement extension-driven native picker/Cancel/focus and its disconnect
ownership; perform full controlled-transfer/detach Rehearsal A and installed
package/registration repair, then macOS and Windows protected-bootstrap and
lifecycle gates. Broader browser update/suspension/discarded-tab cases,
endurance/resource-pressure evidence, media/shell integration and bounded
failure reports remain open. No importer, profile selector, production identity,
route, publication or migration was added. Android transport and service
semantics are unchanged; shared extension helper tests pass, but this Linux
run does not close physical ChromeOS or mobile acceptance.

Cleanup complete: native Quit and owned browser-unit stop left zero executables
from the test layout. Removed the controlled library, registration, browser
profiles/downloads and owned capture. Restored the recorded GNOME idle delay
(300 seconds) and lock setting (enabled), verified them after reboot, returned
the originally-off VM to off, and released the exclusive claim. The idle-lock
recovery followed Machine Control's Linux guide; no outer UI was used.

Machine Control was usable for discovery, read-only doctor, exclusive claim,
readiness, guest transfer/administration, native semantic UI and lifecycle.
Sibling commit `cda5fe9` repairs common `target reboot` dispatch and Linux
capability reporting. Its 100 client tests, Linux static suite (21 tests, one
skipped), claimed common reboot and post-reboot readiness pass. The guest was
shut down only after that validation; no inherited application data was changed.


### Linux installed picker and transfer follow-up (2026-09-29)

Native source `96c1c62b`, unsigned debug deb built by the existing Tauri package
flow (including versioned sidecar and generated release notices). Fresh install
and same-version replacement succeed; no inherited RSTorrent package existed.
Builder/guest ABI checks and guest `ldd` pass. Artifact SHA-256:

- Deb: `bc2927a5fccecf1cd38a4d717110a56628b15d8fa8fcd02d2a150632efac12b0`.
- Installed desktop: `c5b8fba6b521c0e6f798618508158ae3996de49b2bdbbd66c7b94a1a2f4024c7`.
- Installed native host: `aba6fa996729bd7d6b504c6cd5b8da119d9f34c097a4985b570be1ea5c9a326d`.

The initial root was selected through the installed native GTK UI. Extension
Settings/Downloads/Add folder opened the desktop-owned GTK helper. Cancel
returned the normal UI cancellation status and readmission succeeded. Closing
the requesting tab while picking removed the helper, retained exactly one
runtime and added no root. Reopening attached to the same instance. A successful
extension selection registered a second root in the same library. Tray Quit
with a picker outstanding removed both runtime and helper and the protected
socket. An open extension observed attach refusal and explicit Start after
35 seconds without resurrection.

`tests/interop/desktop_extension_seed.py` independently generates a private
32-MiB single-file torrent with libtorrent 2.0.11.0. Its exact infohash is
`5b6fd1f3a92b3661ecfef63f4412edfaea3d48c4`; expected payload SHA-256 is
`99080b09c925782f67975d36476f171ee4e8b367e2a893d07a88bd70028b3fe8`.
The seed/tracker used only the private VM bridge, with DHT/PEX/listening/port
mapping disabled on the controlled RSTorrent library. A temporary firewall
rule admitted only the two owned TCP fixture ports on that bridge and was
removed when the seed stopped. No public swarm was used.

The extension added the torrent through its ordinary file input. Extension
Pause appeared as Paused in native AT-SPI; native Pause/Start subsequently
converged in authenticated extension snapshots. The transfer completed after
the extension tab closed. Guest SHA-256 exactly matched the generated payload;
native progress and reopened extension both showed 100%/complete. After native
Quit and stopping the seed, twelve concurrent explicit native bootstrap starts
returned one new background instance with zero WebKit webviews. The same torrent
and both root IDs restored, complete, and the payload hash remained unchanged.
Invalid and previous-runtime credentials were refused without library disclosure.
Twelve repeated opens retained one companion tab. Background RSS sample:
84,672 KiB, 15 threads; not an endurance claim.

Removing the generated Google Chrome registration manifest inside the controlled
HOME and normally relaunching the installed app recreated byte-identical
registration. Chrome for Testing still uses its custom-profile copy of that
generated manifest: this qualifies deb layout/startup repair and real native
messaging, not automatic discovery by every supported browser distribution.
UI focus under competing GNOME windows, broad suspend/update/failure cases,
macOS and final guest cleanup remain separately recorded gates. Windows
installed validation is in progress. The helper/browser harness uses no host
browser; corrected completion assertions account for CSS-capitalized status text.

### Windows installed follow-up and Linux foreground check (2026-09-29)

The final unsigned Windows x64 debug NSIS installer has SHA-256
`29b16ba775e613e8b7f2b539b236b2727b8a7c6424b0450ed155a834fd69d034`;
installed desktop SHA-256
`48893df21ead4bb25450ffa9df2b42f56ea06e72c7d975d6e5e566914d4efcdd`.
It was built natively with Rust 1.97/MSVC on Windows 11. An initial source
archive preserved timestamps older than cached outputs; its stale capability
advertisement exposed that mistake. Touching the transferred changed files,
rerunning native-host tests, and rebuilding the actual NSIS package corrected
it. Final native bootstrap advertises desktop_control_v1 and
desktop_root_picker_v1 only. This is debug package evidence, not release signing.
The inherited install, profile directories, associations, registration and
shortcuts were preserved before installing the controlled package.

A fresh initial root was selected through the native UI. Chrome for Testing
used the installed HKCU Google Chrome registration without a copied manifest
or code-entry pairing. The extension opened a foreground Windows folder dialog;
Cancel returned normal cancellation status, closing its tab removed the helper,
and a later successful selection added a second root to the same runtime.
The installed final runtime retained one instance across twelve warm starts
and twelve repeated opens retained one companion tab.

The same private 32-MiB fixture completed on Windows with the exact payload
SHA-256 above. Extension Pause appeared in the native library; native Start
converged to complete/running in the extension. Windows transfer completed
before tab detachment; Linux separately proves transfer while detached. The
Windows libtorrent wheel could not load its absent OpenSSL 1.1 dependencies,
so the validated Linux oracle served the private VM bridge instead. The two
owned-port firewall rule and oracle process were removed after the transfer.
No public swarm or personal files were involved.

Tray Quit while picking removed both runtime and helper. A clean repeated Quit
observation returned attach refusal and explicit Start after 35 seconds without
resurrection. One earlier observation was invalidated by the test operator
starting the next explicit race before its observation interval finished; it
is not counted as product evidence. Twelve cold starts returned one instance,
one --extension-background process and no Tauri native window. The seed was
offline; the same roots/torrent and exact payload hash restored. Invalid and
previous-instance credentials disclosed no library. Deleting the controlled
Chrome registration and normally launching the app recreated the identical
manifest route. A working-set sample was 59,891,712 bytes and 492 handles;
this is not endurance evidence.

After controlled Linux reboot/readiness, GNOME reported unlocked and an
extension cold launch opened the GTK picker visibly in front of the browser.
Cancel worked and the native view subsequently showed the persisted torrent
at 100%. This closes the obscured foreground observation from the earlier
locked session, not arbitrary window-manager/desktop-environment coverage.

Machine Control's Windows native reference action exposed a separate defect:
it re-resolves the cached reference's label globally, so native Start selected
the taskbar Start instead. The affected product action was repeated using
fresh native bounds and independently verified by the application snapshot.
That control-tool defect is tracked in the sibling repository; semantic
delivery alone is never counted as application effect.

Builder verification: cargo fmt and workspace clippy pass; the bounded
workspace rerun with --test-threads=2 passed 1,528 tests (18 ignored). Web
409 tests pass (2 skipped), extension 34 pass, and localization checks pass.
The current gateway's application_lifecycle_smoke.py passes both length and
cross_file repair cases, each repairing 32,768 bytes; an earlier stale-binary
failure is superseded by this rebuilt run. Native-host Windows tests and
clippy passed; no full Windows workspace or macOS acceptance is claimed.
Guest restoration and the remaining legacy fixture preparation are ongoing.

### Final cleanup and follow-up boundaries

The Windows native-reference defect is fixed and installed in Machine Control
commits `224febe` and `7e01b8c`; duplicate button/value effects, removed-element
refusal, generation fencing and real product Start converge. The installed
facade passed the same fixture after the common runtime bootstrap.

Windows inherited app/profile directories were restored with 315 matching file
hashes, seven registration/association entries with exact export readback, and
both original shortcuts with matching hashes. The owned browser closed through
CDP and no test runtime/helper remained. The final post-evidence app cleanup
used process termination after an unrelated Windows update prompt prevented
tray-menu access; the separately recorded real-Quit acceptance remains valid.
Build tools and the identified source/target build cache remain for future
incremental builds. Linux's test package, controlled HOME/library/browser and
owned captures were removed; its idle delay 300 and lock enabled were restored.
Windows applied an already-pending OS update during the first shutdown and
rebooted to Winlogon. Protected semantics and the installed controller returned;
a second common shutdown restored the off state. Both originally-off guests
are returned to off and their claims released.

Tactical 233 prepares pinned, closed Linux/Windows legacy writer fixtures and
proposes deterministic union/conflict outcomes. It implements no importer and
qualifies neither migration Rehearsal B nor production replacement Rehearsal C.

### macOS checkpoint contract (2026-09-29, in progress)

Resumed from clean `07a23248`. Common Machine Control discovery and read-only
macOS doctor resolved a suspended Apple-hosted ARM64 guest. An exclusive
ordinary claim and `target up` / `target ensure-ready` restored unlocked Aqua,
resident semantics, capture and input with outer UI prohibited. Builder and
guest both run macOS 26.6.2 ARM64. Preserve the inherited suspended state and
all inherited installations/data; use fresh controlled app state and a separate
Chrome for Testing identity inside the guest. Tactical 233 is context only.

Retain the same private Unix rendezvous and exact-origin, per-runtime bearer
contract. On macOS use `getpeereid` in both directions; an unavailable peer
credential rejects that connection, never terminates the admission owner.
The initial builder test exposed unexpected EOF after duplicate-owner probing:
Tokio 1.53.1's macOS `peer_cred` additionally requests `LOCAL_PEEREPID`, while
this contract needs only the effective UID. The socket pathname ceiling must
also be checked against the actual installed directory before deployment.

Extend the existing short-lived same-executable picker helper to macOS. Its
main thread initializes AppKit as an accessory application and requests
activation for the explicit picker action, then runs pinned rfd's synchronous
NSOpenPanel. It creates no Tauri webview, singleton, application service or
profile. Keep the existing single permit, 16-KiB private pipe frames, 4-KiB
selected UTF-8 path, five-minute deadline, disconnect cancellation and joined
kill/wait on Quit. macOS draws NSOpenPanel through a system process; installed
evidence must confirm that killing/reaping the helper also dismisses its panel.
Failure to initialize activation is an error; native Cancel remains `None`.
Native-window selection keeps its existing parented dialog and shared permit.
No Android or generated semantic contract change is needed.

Source review: locked `rfd-0.16.0/src/backend/macos/{file_dialog.rs,
file_dialog/panel_ffi.rs,utils.rs,utils/policy_manager.rs}` establishes main-
thread dispatch, accessory policy for prohibited apps, modal selection and
system panel ownership. Locked `tauri-plugin-single-instance-2.4.3/src/
platform_impl/macos.rs` uses a temporary Unix socket and asynchronous bind;
installed concurrent LaunchServices requests therefore need independent
one-runtime evidence. Existing native-host `open -g --args
--extension-background` and desktop `RunEvent::Reopen` need cold/warm evidence.
JSTorrent `desktop/host/src/folder_picker.rs` uses AppleScript to avoid needing
NSApplication, but collapses cancellation/errors; this implementation retains
its existing explicit helper failure/cancellation distinction instead.

Official sources reviewed: Apple's [NSOpenPanel](https://developer.apple.com/documentation/appkit/nsopenpanel),
[setActivationPolicy](https://developer.apple.com/documentation/appkit/nsapplication/setactivationpolicy(_:)),
[activation](https://developer.apple.com/documentation/appkit/nsapplication/activate(ignoringotherapps:)),
and [getpeereid](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/getpeereid.3.html);
Chrome's [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
and [worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle);
Tauri's [single-instance guidance](https://v2.tauri.app/plugin/single-instance/).
Chrome 146+ separates Chrome for Testing registration from Google Chrome;
record any test-profile manifest copy separately from ordinary installed
registration/repair. No source or fixtures were copied from these references.

Next: deterministic native bootstrap/helper checks, incremental unsigned app
package, architecture/deployment/dependency inspection, then the installed
Linux/Windows comparison matrix. macOS capability and acceptance remain
unqualified until those results are recorded below.

Builder checkpoint: `cargo test -p rstorrent-native-host` passes 13 unit and
two process tests, including twelve disconnected probes followed by a valid
ready exchange. `cargo test -p rstorrent-desktop --lib` passes 53 tests,
including helper cancellation/reaping now exercised on macOS. Both packages'
`cargo clippy --all-targets -- -D warnings` pass. `cargo fmt --all`, web
typecheck, web tests (409 pass, two skipped), extension tests (34 pass) and
extension packaging pass. The implementation uses already-locked objc2 0.6.4,
objc2-app-kit 0.3.2 and libc as explicit platform dependencies; no new resolved
package version is introduced. Installed AppKit focus/cleanup is still open.

Installed picker iteration: the initial accessory-only helper displayed its
panel, but keyboard shortcuts and AX discovery were unreliable before normal
AppKit launch completion. Its actual five-minute deadline removed both helper
and panel without adding a root. Call `NSApplication.finishLaunching` before
activation: rfd enters a modal loop directly and never calls the normal
`NSApplication.run` startup path. Apple's
[finishLaunching contract](https://developer.apple.com/documentation/appkit/nsapplication/finishlaunching())
identifies that startup work. Requalify panel interaction after this change;
the first panel's visibility alone is not a success checkpoint.

The launch-completion build exposes the helper's AX Open window and accepts
native Go to Folder / Open. Selecting the second fresh controlled root advances
the same application revision from 9 to 10; the helper is reaped and the product
window stays absent. The final AX Open request reports `-25204` as the helper
exits; root registration plus process disappearance and the browser result
independently establish success. Focused desktop tests (53), package Clippy
with `--all-targets -- -D warnings`, format check, and incremental app packaging
pass again. The checkpoint harness now recognizes the shared UI's `Complete`
status for a resumed verified torrent; the application snapshot independently
confirms `desired_running: true`. Its seed version check accepts the repository's
macOS locked libtorrent 2.0.13.0 as well as the recorded 2.0.11.0 fixture oracle;
fixture bytes and v1 identity are unchanged.

Installed Quit iteration: Cmd-Q with an extension panel open exited the runtime
but orphaned its helper and left the system panel visible. The existing tray
Quit's joined shutdown was not the failing route. Locked
`muda-0.19.3/src/platform_impl/macos/mod.rs` maps predefined Quit to AppKit
`terminate:`; `tao-0.35.3/src/platform_impl/macos/app_delegate.rs` reports
`applicationWillTerminate` after termination is committed. This bypasses the
preventable Tauri `ExitRequested` path. Preserve Tauri's default menus but
replace their predefined Quit action with a custom Cmd-Q item that requests
the same joined shutdown as tray Quit. No alternate shutdown owner is added.
Tauri's [custom menu event contract](https://v2.tauri.app/learn/window-menu/)
supports this route. Requalify installed Cmd-Q with a pending picker before
claiming macOS Quit cleanup. The owned orphan is explicitly terminated during
this failed-run cleanup; that action is not passing product evidence.

### macOS installed evidence and replay commands

This checkpoint uses an exclusively claimed Apple-hosted arm64 macOS 26.6.2
(25G83) guest, initially suspended, with no inherited RSTorrent app/library or
Chrome profile. Machine Control's common discovery, read-only doctor, claim,
`up` and `ensure-ready` establish actual availability. `MACVM_FORBID_OUTER_UI=true`
keeps every UI action guest-resident. The inherited resident later exhausted
resources (10,563 `lsof` entries and capture `EBADF`); common `maintenance audit`
and `maintenance repair` restored its supported service without a guest reboot
or machine-control source change. This is test infrastructure evidence, not a
product failure. Inherited notification banners sometimes obscured controls;
AX actions and explicitly targeted guest input avoided that ambiguity.

Builder commands (after `source ~/.profile`):

```sh
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
cargo test --workspace -- --test-threads=2
cargo test -p rstorrent-native-host
cargo test -p rstorrent-desktop --lib
cargo clippy -p rstorrent-native-host --all-targets -- -D warnings
cargo clippy -p rstorrent-desktop --all-targets -- -D warnings
npm run typecheck --prefix clients/web
npm run test --prefix clients/web
npm run test --prefix clients/extension
npm run package --prefix clients/extension
node --check scripts/verify-desktop-extension-checkpoint.mjs
cd clients/desktop
../web/node_modules/.bin/tauri build --debug \
  --config src-tauri/tauri.package.conf.json --bundles app --no-sign --ci
```

The workspace run passes 1,523 tests with 18 ignored across 70 result summaries;
web passes 409 with two skipped, extension passes 34. Native-host passes 13 unit
and two process tests. Each subsequent macOS-only helper/menu change reruns the
53 desktop tests, package all-target Clippy, formatting and incremental package.
The Python fixture runner also passes `ast.parse` syntax validation. These are
builder/scripted results; they do not establish installed picker presentation.
No semantic application DTO or Android behavior changes; the native AppKit,
peer-UID and macOS menu changes are inapplicable to Android.

The unsigned debug app is installed at `/Applications/RSTorrent.app` only in
the guest. `file`, `otool -l`, `otool -L` and bundle metadata establish arm64,
desktop minimum macOS 13.0 (SDK 26.5), native host minimum 11.0 and system-only
dynamic dependencies before transfer. Builder and guest executable SHA-256
values are compared after installation. This does not qualify signing,
notarization, Intel macOS, minimum-version execution or release updates.

Chrome for Testing 151.0.7922.34 arm64, from the separately identified cached
Playwright Chromium distribution, runs in the guest with:

```sh
--user-data-dir=/tmp/rstorrent-t232/browser --remote-debugging-port=9222
--no-first-run --no-default-browser-check
--disable-extensions-except=/tmp/rstorrent-t232/extension
--load-extension=/tmp/rstorrent-t232/extension about:blank
```

The exact packaged beta extension remains
`gcgoepclopkgijmclmlheafaglmbjlcc`; its ZIP SHA-256 is
`c20f22dc1b9d5d05c7c682899c43f8568b1821ecc57416c8ae4a70596032eee4`.
The bundled native host SHA-256 is
`8117aaad97aaebc5135d6bd8521b96169633381ab089cb43f0cf3530012cde86`.
The stable native-host manifest is copied into this intentionally custom
browser profile's `NativeMessagingHosts`; that explicit test-profile setup is
not claimed as automatic discovery. The ordinary Chrome for Testing root is
created separately to exercise installed registration and bounded repair.

Guest browser phases run through the common claimed `os --` transport:

```sh
node /tmp/rstorrent-t232/scripts/verify-desktop-extension-checkpoint.mjs PHASE
```

`open`, `prepare`, `inspect`, `invalid`, `remember`, `stale`, `clicks`, `picker`,
`picker-cancelled`, `detach`, `close-settings`, `stopped`, `race` and `start`
use the same harness as Linux/Windows. Transfer phases additionally set
`RSTORRENT_TEST_TORRENT_FILE=/tmp/rstorrent-t232/checkpoint-transfer.torrent`
and `RSTORRENT_TEST_TORRENT_NAME=checkpoint-transfer.bin`.
Native UI uses common guest `desktop` capture/input and `testbed -- ui`
AX discovery/actions; normal launch is guest `open /Applications/RSTorrent.app`.
Use `--depth 12` for React AX controls and `--depth 4 --limit 500` for panel
controls. Target the observed helper PID when both processes share the bundle
identity. AX Open/Cancel can report `-25204` during successful helper exit;
require the independent browser result, root revision and process cleanup.

The native Settings → Downloads → Add folder flow first selects a new
`/tmp/rstorrent-t232/root-one`; native Go to Folder and Open register it. The
extension subsequently selects `root-two` through its owned native helper.
The private 32-MiB seed runs on the builder's guest-reachable private interface:

```sh
uv run --project tests/interop --locked python \
  tests/interop/desktop_extension_seed.py \
  --root /tmp/rstorrent-t232-seed --bind "$CONTROLLED_SEED_ADDRESS" --seconds 1800
```

The locked macOS oracle is libtorrent 2.0.13.0. DHT, PEX, product listening and
port mapping are disabled by `prepare`; only the private controlled tracker
and seed are used. The extension adds `checkpoint-transfer.bin` into the
native-selected root. Its 33,554,432 bytes independently hash in the guest to
`99080b09c925782f67975d36476f171ee4e8b367e2a893d07a88bd70028b3fe8`, matching
the seed; v1 identity is `5b6fd1f3a92b3661ecfef63f4412edfaea3d48c4`.
Extension Pause appears in the native AX row and snapshot (`running: false`);
native Start advances the shared revision and produces Complete at 100% with
`running: true` in the authenticated extension snapshot. No legacy data or
importer is involved.

The custom Cmd-Q installed retry closes both helper and system panel, exits the
runtime and remains stopped during the full 35-second reconnect observation.
Its desktop executable SHA-256 is
`289dc647446ac96829bf00857460f03d3a05fd96633e672696e1fa4742ce5546`.
The subsequent twelve-request cold race samples exactly one runtime but fails
some replies and creates a native window: repeated LaunchServices background
opens generate normal Reopen events. Registration repair is byte-identical,
and invalid/stale credentials still disclose no library. This race failure
must be fixed before platform qualification; singleton process count alone
is not sufficient.

Mac startup serialization contract: native-host `start_control` takes one
zero-byte, same-user 0600 regular-file lock in the existing private rendezvous
directory before rechecking ready state. No symlinks, hard links, public modes
or non-regular files are accepted. The inode is retained between runs; it
contains no token/state and is never unlinked during normal operation. Standard
[`File::try_lock`](https://doc.rust-lang.org/std/fs/struct.File.html#method.try_lock)
provides OS-released ownership; no launcher daemon, new dependency or persistent
PID authority is introduced. Lock contention plus startup shares the existing
ten-second deadline, with 20-ms bounded polling. `attach_control` never acquires
the lock, launches or waits for a pending start. The first explicit request
alone sends `open -g --args --extension-background`; followers read the ready
runtime after admission. Normal desktop launches retain ordinary Reopen.
Tests cover twelve serialized waiters, contention timeout, drop/reacquisition,
and unsafe lock paths/modes. Installed cold-race qualification is rerun next.

The remaining refused replies were diagnosed as Darwin `EINVAL` from
`UnixStream::set_read_timeout` after the server had already sent ready and
closed. Error-kind/OS-code-only stderr diagnostics identified the boundary;
a deterministic delayed-client test then reproduced exactly error 22 on the
builder. Peer-UID lookup alone did not reproduce it. On macOS, keep the ready
socket alive until client EOF (or one byte) within the existing one-second
exchange deadline. Existing clients already close after reading; there is no
new wire frame, version, credential rule or retry that weakens admission.
Cancellation still interrupts the exchange and only one bootstrap socket is
served at a time. The regression test delays client timeout setup by 50 ms.
This is separate from the startup lock's LaunchServices Reopen fix.

After both bootstrap fixes, three consecutive installed cold races each return
12 successful replies naming one runtime, with no native AX window. A 160-
sample process observation at approximately 100-ms intervals reports maximum
one runtime, zero helpers and 92,144 KiB runtime RSS; no WebKit processes appear
in the cold check. Twelve subsequent explicit opens retain one companion page.
The removed ordinary Chrome for Testing manifest is recreated byte-for-byte;
invalid and retained previous-instance credentials disclose no library.
Final native-host tests pass 17 unit and two process cases, with all-target
Clippy, format and package checks passing. The intermediate diagnostic sidecar
is superseded by a complete rebuilt app. Final executable SHA-256 values,
verified on builder and guest, are:

- Desktop: `1e01b57fe98f40c741d599d27c2971bc180b670aa5a6985228508eec786b092f`.
- Native host: `9737e093124c933864b25031ab1a27679e6e055c204fb29423cab3a292429000`.

The custom browser profile's manifest is refreshed from the repaired stable
manifest after each host artifact change. The installed host uses a versioned
filename, so an old copied test-profile manifest is never sufficient evidence
that a newly built host ran. Normal launch performs the supported registration
refresh before the final cold-start tests.

### macOS installed checkpoint completion (2026-09-29)

The final package above qualifies this bounded macOS checkpoint. Historical
failed/intermediate observations above remain execution records, not current
failures. Comparison with the Linux/Windows installed checklist:

| Check | Installed macOS result |
| --- | --- |
| Cold and concurrent start | Three consecutive twelve-request cold races return one instance each, one sampled runtime and no native AX window; cold runs create no WebKit webview. |
| Warm attach and repeated clicks | Twelve explicit opens reuse one companion tab. The harness now asserts both `tab.active` and the browser window's `focused` state; both pass. |
| Ordinary desktop launch | Guest `open /Applications/RSTorrent.app` opens/focuses the native window on the existing owner; both views coexist. |
| Shared library and controls | Both views show the same two fresh roots and single torrent. Final extension Pause changes revision 11 to stopped intent; native AX Start changes revision 12 to running intent and the extension displays Complete. |
| Controlled bytes | The private 32-MiB transfer completes with the independent SHA-256 recorded above. Final source-offline restart retains complete bytes and the same verified hash. |
| Admission | Authenticated semantic snapshots succeed. Invalid and previous-instance credentials yield refusal without hello/library disclosure on the final native host. |
| Picker | Native UI prepares root-one; extension NSOpenPanel adds root-two without a product webview. Cancel adds no root; tab closure kills/reaps the helper and dismisses its panel; reopen retains the same runtime/library. The five-minute deadline also reaps the helper. |
| Quit | Application-menu Cmd-Q with an outstanding picker passes after the joined-shutdown fix. On the final artifact, the tray Quit AX action exits runtime PID 54279 and picker PID 55323 and removes both windows. A new full 35-second observation after exit refuses attach and keeps explicit Start visible, with no resurrection. |
| Registration | The configured Chrome for Testing test-root manifest is regenerated byte-identically after deliberate deletion. The separate custom test-profile manifest points to the final versioned host; custom-profile copying is not automatic browser-discovery evidence. 240 later finds that this test root was misspelled, so actual default-profile discovery was not qualified here. |

The tray action uses a freshly inspected native AX tree, then:

```sh
machine-control --target macos --claim "$CLAIM" testbed -- ui press \
  'Quit RSTorrent' --app "$RUNTIME_PID" --exact --role menuitem \
  --nth 2 --depth 4 --limit 150
machine-control --target macos --claim "$CLAIM" os -- node \
  /tmp/rstorrent-t232/scripts/verify-desktop-extension-checkpoint.mjs stopped
```

The second exact Quit item is the tray item in this observed tree; do not reuse
its ordinal/PID without rediscovery. A menu-bar coordinate click did not expose
a visible menu and is not counted as the Quit action. Process enumeration,
post-Quit capture and the browser's independent stopped assertion agree.

Resource observations are bounded samples, not sustained-load claims: cold
race maximum runtime RSS 92,144 KiB; final native-window runtime sample
127,184 KiB; picker helper sample 49,232 KiB (earlier sample 56,288 KiB).
Only one picker permit exists, with the five-minute deadline, bounded pipes
and joined kill/wait unchanged. No persistent picker process or second library
is introduced.

Machine Control's resident twice lost semantic/capture readiness while its
independent session probe still reported an unlocked Aqua desktop. The first
failure included `EBADF` and 10,563 resident `lsof` entries. Supported common
`maintenance audit` / `maintenance repair` restarted only that resident and
restored readiness; neither incident is product lifecycle evidence. The second
repair preceded the final tray-Quit assertion. No Machine Control source
change, guest reboot, outer UI, host browser or lock-safety bypass was used.

Follow-up evidence now lives in 234–240: bounded three-platform intent/tray/
worker/discard behavior passes in 234; Linux Quit/launch overlap is fixed in
235; selected beta mixed-version replacement/repair/rollback passes on Linux
in 236 and macOS/Windows in 237. 238 passes native signed published-cohort
updates on macOS/Windows/Linux, but those sources predate extension control. 239
passes bounded browser/transfer recovery on all three, plus macOS VM pause/resume.
Linux now passes the browser/transfer/Quit and signed-channel follow-ups on an
explicitly recreated guest with verified registry-located credentials. Its
native suspend-to-idle attempt failed to recover; physical sleep/wake remains
open. Final guest cleanup and released claim are recorded in 238/239.
240 adds signed current-source 0.2.801 delivery, both outer DMGs notarized and
stapled, native updates, actual default-profile CFT registration/repair and a
repeated three-platform control/transfer/picker/Quit matrix. This supersedes
the misspelled configured Mac test root without rewriting its historical scope.
Native physical sleep, interrupted updates, broader endurance,
Intel/minimum-supported-macOS execution and production release readiness remain
unqualified. Tactical 233 remains fixture context only: importer work waits
for discussion; no personal-data migration was started.

Cleanup: real tray Quit left zero runtime/helper processes; CDP `Browser.close`
then left zero Chrome for Testing or crashpad processes. Unregistered only the
two task-owned app bundles with `lsregister -u`, removed the fresh installed
RSTorrent app/library/preferences/WebKit/cache, both task-created Chrome for
Testing support directories, custom browser profile and controlled temporary
tree. Removed all 16 capture artifacts created under this exclusive claim.
The saved inherited LaunchServices preference dictionary was unchanged, so no
restore write was necessary. No inherited applications or personal data were
removed. Rechecked owned paths/processes absent, activated the inherited
Terminal, restored the guest from running to its original `suspended` state
through common `target suspend`, and released the exclusive claim. Builder
seed completed normally; temporary fixture, logs, scripts and captures are
removed after recording this evidence. Incremental build caches are retained.
