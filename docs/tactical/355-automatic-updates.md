# Tactical 355: Unattended Desktop Updates

Status: In implementation, 2026-10-16. Maintainer accepts a desktop restart
after 15 minutes without interaction, including a brief interruption of
downloads and seeding. Maintainer authorizes autonomous end-to-end implementation and VM testing.
Default-on installation, the 60-second notice and one-hour snooze are accepted
for this execution. Push and publication remain outside the authorization.

Maintainer clarification: preserve foreground versus non-foreground behavior
across the update. Exact window stacking order is not required; a background
update must never interrupt another application.

Topics: `beta-release-readiness`, `product-surfaces-and-migration`,
`client-surfaces`, `mixed-version-compatibility`,
`runtime-configurations-and-headless-deployment`.

## Problem And Stopping Condition

Desktop updates should check, download, install and return the host to work
without a click. Installing only on quit or the next launch leaves a
long-running torrent host outdated indefinitely. Waiting for all transfers
to finish has the same problem for continuous seeding.

Bound this tactical to JSTorrent desktop macOS `.app`, Windows NSIS and
Linux AppImage. Stop when unattended signed updating is qualified on each
supported desktop target, including a windowless host, retained user data,
resumed transfer intent, attached-client recovery and failed attempts.
Source tests alone do not qualify a platform. Other surfaces remain separate
follow-ups and do not hold this desktop slice open.

## Pre-implementation Survey

- `clients/web/src/inspection/updater/schedule.ts` schedules checks five
  seconds after client creation, then every 24 hours on Stable or 30 minutes
  on Latest. The React controller owns the schedule, not the native host.
- `clients/web/src/tauri-updater.ts` and
  `clients/desktop/src-tauri/src/update_channels.rs` already perform native
  checks and installation, with selected-channel and candidate-generation
  guards. The client invokes combined download/install and then restart.
- `clients/web/src/inspection/updater/policy.ts` permits in-app installation
  only for app, NSIS and AppImage. MSI/DEB/RPM remain package-managed. About
  says installation needs approval, although one status says automatic
  updates are enabled; this distinction must become clear.
- `desktop_lifecycle.rs` and `lib.rs::perform_application_shutdown` own joined
  desktop shutdown. Tactical [234](234-desktop-user-intent-and-background-lifecycle.md)
  preserves the host when browser views disappear and makes explicit Quit
  terminal until a new explicit launch.
- The exact locked `tauri-plugin-updater` is **2.10.1** (Cargo.lock). Its
  `src/updater.rs::Update::download` returns bytes after signature verification;
  `install` does not repeat verification. Download completion is signaled
  before verification, so that callback cannot mean ready to install.
- Windows `install_inner` starts the installer and calls
  `std::process::exit(0)`. Its synchronous `on_before_exit` hook is not an
  awaited application shutdown. macOS can request administrator authorization;
  AppImage replacement includes rename/write steps. These paths do not prove
  prompt-free updating, crash-atomic replacement or automatic recovery.

The survey used the locally locked registry source; no upstream code or
fixtures were copied. Official [Tauri updater documentation](https://v2.tauri.app/plugin/updater/)
explains separate download/install, Windows exit behavior and install modes.
Exact locked source governs implementation rather than potentially newer docs.

## Product Policy

| Choice | Plan |
| --- | --- |
| Transfer interruption | **Accepted:** restart after 15 minutes without interaction; briefly pause and resume downloads and seeding. |
| Default | **Accepted:** automatic installation on for qualified self-updating installations, with a clear Settings opt-out and concise first-upgrade notice. |
| Opt-out | Keep automatic checks and explicit Install & Restart; stop unattended downloads and cancel any restart that has not committed. |
| Release selection | Keep the selected Stable/Latest channel and no-downgrade behavior; never enroll a user in Latest. |
| Before restart | **Accepted:** a non-modal 60-second notice with Restart now and Later. New interaction cancels it and starts a fresh 15-minute quiet period. Later also snoozes for one hour. |
| After restart | **Accepted:** resume the same host/profile and saved torrent intent. If the app was not foreground, relaunch without activation; exact window stacking order is irrelevant. Closed/hidden and minimized windows stay that way. |
| Quit or OS shutdown | Takes precedence over an uncommitted update. Never relaunch merely because an update was pending. |

Attached clients show the notice and update status; OS notifications are
optional. A host with no open view still updates without acknowledgment.
No forced deadline overrides activity, a blocker, a snooze or an opt-out.
This supersedes Tactical [343](343-about-support-and-remote-updates.md)'s
explicit-action-only non-goal for this desktop scope; its remote-update
work remains complementary.

### Window State Across Restart

Capture whether the native app is foreground at the update handoff, plus
whether its window is open, minimized or closed/hidden. Apply that intent
before startup can show or activate a window. The requirement is to avoid
activation when the app was not foreground, not to reconstruct the desktop's
window stacking order. Do not infer foreground intent from merely having an
open window or having been focused earlier in the download/countdown.

| State before update restart | State after update restart |
| --- | --- |
| Native window in the foreground | Restore it to the foreground, unless the user has switched to another application during restart. |
| Window open but not foreground | Reopen without activation. No exact placement among other windows is required. |
| Window minimized | Keep it minimized without activation. |
| Window closed/hidden, host running in the background | Keep the window closed/hidden and the host running in the background. |

A newer user focus choice during restart takes precedence over the captured
state. In particular, beginning an update in the foreground does not authorize
stealing focus back from a document the user starts typing in during restart.
The update notice, installer and startup must also avoid transient window
flashes or activation. A remote/extension connection does not imply a request
to open or focus the native window. Consume the update's restoration context
once; a later ordinary explicit launch still opens the app normally.
Verify non-activating relaunch on each platform; do not promise a portable
stacking-order restoration mechanism or add one to this tactical.

## Interaction And Restart Blockers

Measure interaction with JSTorrent, not whether the entire computer is idle.
Using another application should not stop a background JSTorrent update.

- Input and focus acquisition in the native window, extension companion or
  authenticated remote controller reset one host-owned quiet clock. Accepted
  user commands, magnet/torrent intake and tray/menu actions do too.
- Transfer bytes, seeding, subscriptions, reconnect attempts, update checks
  and automatic refreshes do not count as user interaction.
- Clients send bounded, coalesced activity signals, not raw keystrokes,
  pointer positions or content. These stay at the host, outside statistics.
- An attached browser alone is not activity, but eligibility requires known
  client state. A connected older client that cannot report activity, or a
  connected client with stale reporting, blocks quiet restart with a visible
  waiting reason. Disconnected clients stop blocking after connection cleanup.
  A lost heartbeat is not proof a connected view is idle.
- Sleep cannot run down the clock. On wake, establish a fresh quiet period,
  refresh client state and revalidate the candidate. Wall-clock changes cannot
  make an update immediately eligible.

Even after 15 minutes, automatic restart waits for:

- media playback and active host-served file transfers;
- native file/folder pickers, pending add/file selection, dirty settings
  drafts and other unfinished user flows;
- import/export, data clearing, migration or another operation that cannot
  safely resume to leave its critical section;
- enough disk space, a writable qualified installation and a platform install
  path known to work without an elevation or authorization prompt.

Native state and host resources own observable blockers; clients report
client-only drafts and flows. Persistent unfinished add intent still blocks
when its window closes. Resumable downloading, seeding and checking may
continue until shutdown; prove their restart behavior instead of treating
every busy torrent as a veto.

## Update Flow And Failure Rules

1. **Check in the host.** One native owner checks with the window closed.
   Initially retain channel cadences, add bounded jitter and coalesce
   wake/start/manual requests. Do not launch a deliberately stopped app just
   to check for updates.
2. **Download and verify.** Keep transfers running. Pin version, channel,
   target and signature to one candidate generation; download separately from
   install. Persist the verified artifact and bounded metadata across normal
   restarts. Partial or invalid bytes are never ready. Reverify cached bytes
   immediately before installation, including after process restart.
3. **Wait for a safe opportunity.** Show downloaded/waiting status and concrete
   blockers. Start the notice when quiet and unblocked. Channel changes,
   opt-out, new input and invalid candidates cancel it. Refresh release
   eligibility before commitment; offline hosts retain the download and wait.
   Do not install a withdrawn candidate.
4. **Commit once.** Atomically recheck activity, blockers, preferences and
   generation, then admit one update. Stop conflicting mutations/intake at
   the lifecycle boundary. A racing request either cancels admission or gets
   a retryable restarting result; never acknowledge an add and lose it. Drain
   and join engine/storage/application owners before replacement or installer
   exit. A shutdown failure prevents installation.
5. **Install and relaunch.** Preserve profile, foreground/background window
   state and user intent under the rules above. Do not replay startup magnets,
   torrent files or other one-shot arguments. An ordinary launch during
   replacement cannot create a second
   owner. Qualify Quit/OS-shutdown precedence through the installer handoff;
   it must not become an unwanted relaunch.
6. **Confirm success.** Record success only when the intended version opens
   its stores, completes migrations and starts the application service.
   Clients reconnect and read fresh hello/snapshot state without replaying
   mutations whose outcomes are unknown. Show the last outcome and a concise
   Updated to ... notice on next interaction.

Interrupted downloads, bad signatures, low disk space and preflight refusal
leave the installed version and transfer intent intact. After failed shutdown,
recover stopped owners or show needs-attention state; do not pretend the host
is still fully running. Failure after replacement needs a documented recovery
path that retains user data. Universal desktop rollback is not assumed: an
older executable may not read a newly migrated database. Never restore an old
catalog over newer user data. Tactical [369](369-catalog-recovery-screen.md)
remains the fail-closed catalog recovery path.

Retry transient check/download failures with capped backoff (proposed 5 min,
30 min, 2 h, then normal cadence). Persist the attempt before handoff and
suppress automatic reapplication after install/startup failure until explicit
retry or a different candidate. Continue checking for a fix. An unfinished
attempt marker must not cause an install/crash loop at startup.

## Ownership, Bounds And Compatibility

- **Host:** one update owner, schedule, candidate, quiet clock and install
  admission. It cancels and joins check/download tasks on shutdown; the
  installer handoff has an observable attempt record.
- **Platform adapter:** package capability/preflight, replacement, installer
  launch and restart presentation. Prove each OS path independently.
- **Clients:** present the host snapshot and submit update/preference/activity
  operations. Closing a view cannot cancel the host's download or candidate.
  Manual and remote updating use this same owner, including Tactical 343.
- **Persistence:** preferences and outcomes belong in `product.db` through
  append-only migrations and released-store fixtures. Binaries are disposable
  cache, not another settings database. Add migration/reader rows to
  `durable-data-migrations` when implemented.
- **Bounds:** one check/download/install at a time, one staged candidate,
  no per-input task or activity history. Proposed artifact cap: 512 MiB;
  expanded payload cap: 2 GiB. Reserve disk for staging, replacement and the
  platform backup. Measure current release sizes and peak memory/disk before
  finalizing limits. The plugin's unbounded download buffer is insufficient;
  select bounded staging/verification before coding. Keep the existing
  20-second check timeout; give downloads a separate bounded timeout.
- **Dependency direction:** pure eligibility transitions take explicit time
  and activity inputs; runtime/platform adapters depend inward. No installer
  or activity dependency belongs in the engine. This plan adds no privileged
  updater service or daemon.
- **Mixed versions:** new public operations/settings are capability-gated;
  new host fields optional/defaulted. Old clients keep their manual path;
  new clients fall back when a host lacks automation. Reuse the authenticated
  application/remote boundary without a new listener.
- **Trust/privacy:** preserve JSTorrent identity, routes, signing root,
  channel confirmation and statistics opt-out. Keep check-only headers off
  artifact downloads. Never cross the frozen incubation signing root.

## Ordered Implementation And Evidence

1. **Prove platform feasibility first.** Inspect pinned plugin tests and
   installer templates/harnesses. Script signed isolated-identity
   download/verify/shutdown/install/relaunch on macOS, NSIS and AppImage.
   Use the synthetic-update VM rehearsal below as the repeatable gate.
   Resolve Windows exit-before-join and relaunch arguments, macOS
   authorization/translocation, foreground/background restoration without
   transient activation, and interrupted replacement recovery.
   Stop for direction if a privileged helper, plugin fork or substantial new
   dependency is needed. Unqualified installs show needs-attention status.
2. **Move authority and staging native.** Reuse the channel/check machinery
   in one host owner; retain manual IPC behavior. Add bounded staging,
   attempt records, cancellation and snapshots. Prove windowless operation
   and removal of duplicate client timers.
3. **Add quiet restart and controls.** Implement pure eligibility,
   client activity/blockers, preference, notice/snooze and restart context.
   Coordinate shared update operations and reconnect UI with Tactical 343;
   unfinished remote work cannot justify ignoring attached remote users.
4. **Qualify and enable.** Default-on activation follows evidence per target.
   Update Settings copy, format claims, release guidance and owning topics.
   Signing, testbed mutation and publication are future execution work.

| Layer | Required cases |
| --- | --- |
| Deterministic | 15-minute boundary; notice; input/snooze; multiple/old/stale clients; persistent blockers; opt-out/channel races; wake/clock changes; concurrent manual/automatic install and Quit. |
| Scripted host/client | Window closed throughout check/download; client departure; missing-length/oversized/corrupt/interrupted download; cache corruption; withdrawn candidate; preflight/shutdown failure; persisted failure suppression; no leaked tasks. |
| Signed installed update | Every supported OS/architecture; correct root and wrong-root refusal; ordinary-user no-prompt install; actual running version; no focus theft; explicit Quit stays stopped; interrupted installation/replacement and documented recovery. |
| Window state | Foreground returns to foreground when the user has not switched away; non-foreground relaunch does not activate; minimized stays minimized; closed/hidden stays in the background. Exact stacking order is not asserted. Type in another app throughout a background update and switch away during a foreground restart; no notice, installer or startup window steals focus or flashes in front. |
| Transfers/data | Controlled download and seeding across update with independent final hashes; paused stays paused, running resumes; retained roots/settings/statistics choice; released session/product fixture migrations without reset. |
| Attached clients | Native/extension/remote activity postpones restart; playback/file serving blocks; notice/Later; fresh reconnect/snapshots; older-client fallback; no replayed mutation or launch argument. |

### Synthetic-Update VM Rehearsal

Maintainer direction: test real installed updates in Machine Control VMs,
including foreground behavior. Make this a reusable JSTorrent runner, not a
manual release-day observation or a mock that only changes a version label.

**Fixture builds and feed.** Produce two packaged builds, A and B, with
increasing synthetic versions and recorded source/build/executable hashes.
Both contain the actual update implementation and ordinary installer/relaunch
path. Use a dedicated qualification identity, profile, updater key and private
fixture feed; never redirect production installs, modify public manifests or
reuse the frozen incubation lane. Sign updater payloads normally and verify
them through the real verifier. Platform code signing/notarization and
current-user installation must match shipping behavior for platform acceptance;
an ad-hoc development build is useful preliminary evidence only. An inert
candidate is enough initially: it need not contain an unrelated product change.

The controller releases the B offer only after A's initial window state and
focus observer are established. Support controlled slow/interrupted downloads,
wrong signatures, withdrawn offers and failed install/startup variants. Keep
all artifacts/feed endpoints scoped to the rehearsal. Do not use a test flag
that calls restart directly or bypasses verification, eligibility, shutdown or
the installer.

**Machine Control ownership.** Follow the sibling checkout's common
`bin/machine-control` CLI, `docs/cli-guide.md` and the macOS/Windows/Linux
platform guides. Resolve concrete targets from private runtime inventory;
start with read-only doctor and use an exclusive claim and isolated workspace.
Run native actions and observers inside the logged-in guest, with the VM console
unfocused or closed on the controller. Machine Control owns generic transport,
VM lifecycle, native desktop input/observation and recovery; this repository
owns builds, the update fixture, product assertions and the rehearsal runner.
Do not copy private VM selectors or credentials into the plan or runner.

**Independent focus oracle.** Open a disposable editor in the guest, focus it
once, then deliver a numbered text sequence through ordinary keyboard routing
throughout the update. Do not target/refocus the editor on every input or set
its text directly through accessibility: either could mask a focus steal.
Observe native foreground/focus transitions across download, notice, installer,
old-process exit and new-process startup. Assert that all expected text reaches
the editor exactly once and that JSTorrent/installer windows never activate in
the background cases. Record window visibility too, to catch a startup flash
without a focus change. Use a guest-native event observer where supported;
sampling and before/after screenshots alone cannot prove no transient focus
steal. An observer gap is missing evidence, not a pass. Keep screenshots or
recording as supporting evidence rather than the only oracle.

| Scenario | Required result |
| --- | --- |
| A window closed/hidden; host transferring in background | B runs with no native window shown or activated; editor keeps input. |
| A open but not foreground | B may reopen without activation; editor keeps input. No stacking-order assertion. |
| A minimized | B stays minimized and does not activate; editor keeps input. |
| A foreground; no subsequent user switch | B returns to foreground. Do not keep typing into JSTorrent, which would correctly postpone the update. |
| A foreground at handoff; user switches to editor during restart | B does not reactivate over the editor. Coordinate the switch with a real handoff phase, without blocking or replacing the production restart path. |
| User interacts with A during the notice | Countdown cancels; no replacement/restart until a fresh eligible quiet period. |
| Explicit Quit, failed signature or interrupted download | No unwanted relaunch/replacement; retained data and retry behavior match the failure rules above. |

Every successful scenario must independently prove that B's executable is
actually running, exactly one host owns the profile, the source process
terminated and transfer intent/data survived. Populate a disposable library
with downloading, seeding and paused torrents; use controlled peers and
independent payload hashes. A changed About label or an installer exit code
alone is insufficient.

**Timing and repetition.** Use fake time for deterministic eligibility tests.
Fast VM iteration may use a build-time qualification-only timing override,
recorded in the report and absent from shipping builds. Before qualification,
run an unaccelerated 15-minute quiet period plus the normal notice on each
supported OS. Repeat foreground-sensitive cases at least three times with
different download/handoff timing; one lucky pass is insufficient. Record
OS/architecture and display-session backend; Linux desktop/compositor behavior
and other architectures cannot be inferred from one VM. Start with available
macOS, Windows and Linux VMs, then explicitly close remaining target gaps.

**Runner output and cleanup.** Plan a runner in this repository that prepares
the fixture, performs the matrix under a bounded claim and emits a structured
pass/fail report. Include artifact/source hashes, versions/PIDs, exact timing
mode, update phases, observed focus/visibility events, editor-content assertion,
transfer hashes and cleanup results. Retain minimized private failure evidence;
remove temporary feed/downloads, profiles, fixture editor files, observers,
processes and test trust/registrations, restore the target's initial power state
and release workspace/claim in finally/trap cleanup. Do not mark a run complete
when cleanup failed.

Existing inputs inspected: `scripts/prepare-jstorrent-upgrade-trial.mjs` binds
private trial manifests to authenticated candidate bytes, and
`tests/interop/legacy_desktop_signed_update.py` proves real replacement and
negative-download/signature outcomes. Neither currently tests this new native
unattended owner or foreground contract; reuse applicable mechanisms rather
than claiming those historical passes cover it. The synthetic build/feed and macOS runner are implemented; execution evidence
and remaining qualification gaps are recorded below.

Use deterministic tests and scripted runners first, then separate test browsers
and claimed Machine Control guests for native presentation/installer evidence.
Run the proportional Rust/web/contract baseline from AGENTS.md when implementing.
Record exact checks, artifacts, resource high-water marks, gaps and cleanup.
No live public swarm is needed. Implementation validation is recorded below; it is not signed shipping-package
qualification.

## Other Surfaces And Compatibility Horizon

- **Android:** Play already owns automatic distribution. Flexible In-App
  Updates remains a separate possible tactical/dependency decision.
- **Extension:** retain Web Store updates and test reconnect after a host
  update. Do not assume prompt store delivery or permission approvals.
- **MSI/DEB/RPM:** retain package ownership and accurate manual guidance;
  no automatic conversion or package-manager integration here.
- **Headless/Crostini:** follow the single self-updating Linux CLI direction
  in `runtime-configurations-and-headless-deployment`, with its own release
  identity, detached apply, health check and rollback. Do not revive or
  redirect frozen packages. Desktop inactivity does not decide server
  maintenance policy.
- **Hosted client/iOS:** retain website/App Store ownership.

The mixed-version support horizon stays **30 days**. Existing manual-update
installs must install the first automation-capable release once. Closed apps,
opt-outs, unqualified installs and old clients remain real limits. Check
populations describe active checkers, not every installation; observing a
version does not prove install success. A tighter horizon needs a separate
decision based on permitted uptake/failure evidence. This tactical neither
enforces a minimum version nor retires durable-data migrations.


## Execution Checkpoint — October 16

The native owner, deterministic policy, signature-verified staging, joined
shutdown/replacement, presentation handoff, bounded intake, persistent
preference/outcome and shared activity/control UI are implemented. Product
schema 4 appends its desktop row without editing schema 2 or 3. Capability 4
keeps new calls away from older hosts; the compatibility horizon stays 30 days.

**Shipping activation remains disabled** in
`automatic_updates::automatic_available`. Isolated qualification builds run
the complete automatic path under a separate identity and disposable updater
key. Shipping identities, trust roots and routes are unchanged. A shipping
target needs its signed-package acceptance record before activation. Stored
opt-outs remain authoritative, and manual app/NSIS/AppImage installation is
available. Android/extension/headless distribution ownership is unchanged.

### Native Evidence

Passing receipts, source hashes and signed payload hashes are retained in
[355-update-evidence.json](355-update-evidence.json). Each receipt binds its
own snapshot; later changes are not silently attributed to an older run.
Failed runs are summarized here and never counted as passing receipts.

- **macOS ARM64:** two complete accelerated matrices pass hidden, unfocused,
  minimized, foreground and switch-away-during-gap cases. The closed-existing-
  window case also passes. Every successful replacement checks real B bytes,
  a new host, original process gone, preserved statistics opt-out and durable
  success. Native visibility/activation and exact untargeted keyboard hashes
  protect background runs; no exact stacking assertion is made.
- **Real macOS timing:** hidden and unfocused runs pass the actual 900-second
  quiet interval and 60-second notice. All 1,035 and 1,053 respectively injected
  characters reach the independent editor without activation. The first
  real-timing setup failed to clear/verify the editor and is not a pass.
- **Controlled macOS transfers:** an incomplete 16-MiB download resumes to its
  independent hash, paused intent/content stay unchanged, seeding stays enabled,
  and B uploads 2 MiB of exact content to a fresh pinned-libtorrent receiver.
  Private peer processes and content clean up. No public swarm is used.
- **macOS failures:** bad signature, oversize, interrupted download, withdrawn
  release and offline revalidation pass refusal checks with A alive and its
  executable unchanged. Only verified bytes remain eligible for cache reuse.
- **Windows 11 ARM64:** signed NSIS foreground, hidden and unfocused runs pass
  actual replacement, new B/old A termination, non-elevated A/B tokens and
  native foreground controls. Background input hashes match exactly. Hidden
  and unfocused cases also verify retained privacy choice and successful
  startup outcome. The fresh minimized pair passes all 14 assertions, including
  visible iconic A/B states, exact B bytes, ordinary tokens, no visible normal window, no
  activation, exact keyboard input, durable state and cleanup.
- **Linux ARM64, GNOME 46 Wayland:** the current GTK fix passes unfocused,
  hidden and minimized AppImage replacement with exact image hashes, retained
  privacy/outcome and exact background keyboard routing. Minimized checks
  independently confirm native iconic state for both A and B. The strict
  foreground rerun also passes native B activation and current active-window
  state. Its first attempt stopped before fixture creation at
  Machine Control preflight; a fresh read-only doctor recovered readiness
  before the successful rerun.

### Concrete Integration Findings

Tauri strips NSIS packaging options from runtime `Config`. Build-time merged
configuration now records current-user installer mode; runtime admission still
checks package type, write access and space. Windows copies a one-shot helper,
waits for A, runs silent current-user NSIS without `/R`, waits with a deadline
and explicitly launches B with presentation/cancellation context. Installer
failure restores A's executable. The helper's explicit `asInvoker` manifest
fixes the observed Win32 error 740 without elevation or UAC policy changes.

Ordinary show-after-minimize restored the Windows window. Returning after
minimize left it iconic but hidden. The current implementation posts
`SW_SHOWMINNOACTIVE` through a bounded, windowless OS helper, preserving this
crate's unsafe-code prohibition. Its native minimized/visible/non-activation rehearsal passes. Failed builds
and state assertions remain failures.

The locked Tauri CLI patches exactly one package marker inside NSIS, then
restores the unsigned build-cache executable. The hash oracle independently
computes that exact transformation and compares every installed byte. It
ignores no arbitrary differences. Windows observation excludes only the exact
locked Tao/single-instance message-target classes with all four non-presenting
extended styles; the real-window foreground control passes.

GTK's builder focus guard alone did not prevent activation. Focus-on-map now
follows presentation, and unminimize runs only for an actually minimized
window: unconditional deiconify of a never-minimized window caused the real
background activation. GNOME's virtual keyboard broker can briefly toggle
editor activity even without an update. A no-update control records that;
independent top-level AT-SPI activation and exact keyboard hashes remain
required. Temporary setup focus/raising ends before offer, and native state
checks prevent a topmost editor from masking a product failure.

Automatic-update failure dialogs recheck current foreground before opening;
installation diagnostics persist as the bounded last attempt. The first
enabled release explains idle updating and the Settings opt-out in a one-time
foreground toast, combined with a success notice when both apply. Its seen
state is a UI preference; it never controls installation or consent. Their packaged
failure/recovery matrix remains open. No failure-path qualification is inferred
from a successful replacement.

### Validation And Cleanup

Local validation passes `cargo fmt --all -- --check`,
`cargo clippy --workspace --all-targets -- -D warnings`,
`cargo test --workspace`, `cargo test -p rstorrent-desktop --lib`,
`npm run typecheck --prefix clients/web`, `npm run test --prefix clients/web`,
`npm run build --prefix clients/web`, and
`npm run check:localization --prefix clients/web`. Rust commands source
`scripts/dev-env.sh`. There are 75 desktop and 844 passing web tests, with 3
explicit web skips; the CSP check covers 50 built JavaScript bundles. Python
qualification tools pass `python3 -m py_compile`. Native fixture builds compile
the platform-specific branches as well.

The deterministic cases include quiet/notice/snooze boundaries, clock jumps
and suspend, stale/unknown clients, bounded capacity, signature/cache failures,
channel/downgrade/URL/field limits, and archive traversal/link/special-file/
expansion limits. The public signer vector is independently generated; its
private key was deleted. No upstream implementation or test data was copied.

Per-run cleanup is checked in all 29 passing receipts. Every guest is cleaned,
powered off and released. Windows build/task/profile data and the temporary
Rust toolchain are removed. Linux task-local swap is disabled/deleted, the
package auto flag is restored, six owned extraction caches and the test profile
are deleted, and owned clipboard contents are cleared. Unowned state is retained.
Host fixture caches, archives and private investigation artifacts are removed. UTM's intermittent unavailable
automation endpoint refuses before dispatch; no private transport or identity
bypass is used. Outer UTM UI was raised/inspected once during earlier Windows
controller diagnosis; subsequent control uses the common CLI.

### Next Executable Actions And Release Gates

The available native ARM64 matrix is recorded and cleanup is complete. Next,
qualify shipping-signed artifacts and production installer hooks, obtain the
missing architecture targets, and execute the remaining timing, repetition,
client and failure gates below before changing the shipping activation guard.

Shipping signatures/notarization and production installer hooks, missing
architectures, full 900/60 timing on Windows/Linux, required presentation
repetitions, packaged Quit/intake/client reconnect and installer/crash/power-loss
recovery, and resource high-water evidence remain open. Available VM targets
are ARM64; no x86_64 qualification is inferred from them. Tactical 355 remains
in implementation and does not claim production unattended-update readiness.
