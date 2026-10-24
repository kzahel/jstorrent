# Tactical 234: Desktop User Intent And Background Lifecycle

Status: **Bounded macOS/Windows/Linux checkpoint complete, 2026-09-29.**
Implementation and installed qualification extend Tactical 232; broader
endurance and update compatibility remain separate campaign work.

Parent: [232](232-desktop-extension-control.md), campaign
[231](231-jstorrent-migration-working-campaign.md).
Topics: `client-surfaces`, `runtime-configurations-and-headless-deployment`,
`application-connection-architecture`, `application-view-api`, `web-ui-design`, `capability-readiness`,
`desktop-jstorrent-replacement`, `product-surfaces-and-migration`.

## Outcome And Accepted Rules

The desktop runtime owns one library and its torrent engine. The extension's
packaged React tab and native window are independent views of that owner.
Closing or losing the browser UI does not stop the engine. The runtime must
retain its tray/status-bar icon throughout its lifetime, including idle,
paused and seeding states; no hide-icon preference or completion shutdown is
introduced. Notification permission and browser badges are not lifetime gates.
OS-controlled tray placement/overflow is distinct from the application hiding
its icon. Verify actual indicator availability on supported guest desktops.

| Trigger | Runtime intent | Presentation |
| --- | --- | --- |
| Actual extension toolbar action | Start or attach, including after Quit | Open/focus extension UI in the invoking browser context |
| Explicit Start in extension UI | Start or attach, including after Quit | Reconnect that UI |
| Browser/page restore, reload, retry, worker wake/start | Attach only | Existing extension UI; stopped runtime offers Start |
| Extension tab/browser closes | Preserve runtime | Tray remains; native window is independent |
| Tray Show/Open or ordinary desktop launch | Start/retain sole owner as applicable | Native desktop window |
| OS-delivered magnet or `.torrent` activation | Start/retain sole owner | Native intake UI |
| Explicit Quit | Joined shutdown; future explicit intent can launch again | Remove tray; connected browser shows Start |

No preferred UI, last-used surface routing, browser-profile discovery or native
attempt to launch a particular browser profile. Both views can coexist. The
existing default-on **Run in Background** setting continues to govern native
window close only; disabling it does not make browser disconnection an exit.

## Scope, Non-goals And Stopping Condition

Implement and test the intent boundary, same-owner recovery, persistent tray
and native routing on macOS, Windows and Linux. Stop after deterministic gates
and installed controlled-guest matrices pass, with exact artifacts, cleanup,
resource observations and remaining limitations recorded. Never infer installed
platform behavior from a shared unit test or another platform's success.

No importer, personal migration, profile selector, browser network interception,
new browser permissions, auto-shutdown policy, notification campaign, offscreen
engine, runtime architecture replacement, updater publication, production
identity or release claim. OS association dispatch is in scope; intercepting
all website magnet links inside the extension is not. Mixed-version refusal
and stale attachment remain tested; full installer/update compatibility and
production rollout remain separate campaign gates.

## Source Review And Design

Existing desktop tray construction is unconditional, including background
startup. Its Show action and admitted OS inputs already restore the native
window. Preserve those routes and qualify them without browser-profile logic.
The extension popup currently calls Launch on document initialization; a
restored/direct popup tab must not count as a toolbar click. Distinguish the
actual popup view before automatic launch; explicit buttons remain available.
Companion connection setup/retry remains attach-only and page ownership must
clean up across pagehide, restoration and disconnect during asynchronous mount.

Official inputs: Chrome [extension views](https://developer.chrome.com/docs/extensions/reference/api/extension#method-getViews),
[action popup](https://developer.chrome.com/docs/extensions/reference/api/action),
[worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle),
and Tauri [system tray](https://v2.tauri.app/learn/system-tray/).
`chrome.extension.getViews({type: "popup"})` returns actual popup window
objects; matching this document's window avoids treating a tab with the same
URL as a user action. No added permission or persisted launch-intent flag.
Tactical 162 owns prior tray/source review; Tactical 232 owns bounded bootstrap,
picker and native AppKit decisions. Engine/protocol behavior is unchanged, so
this slice adds no libtorrent algorithm/reference requirement.

## Ownership, Cancellation And Bounds

- Desktop shell owns the tray, native window, bootstrap, application service
  and joined shutdown. Browser connections cannot remove the tray or own exits.
- Extension worker owns bounded bootstrap/open requests and a remembered tab
  ID, never credentials or an engine. Worker restart does not replay Start.
- Each browser page owns one attachment attempt/connection, one mounted React
  view and one retry timer. Departure cancels that owner; late asynchronous
  completions must close/unmount, and restoration may attach but never start.
- Existing four-client, HTTP, frame, upload and single-picker limits from 232
  remain unchanged. No unbounded retry/task list or background observer added.
- Dependencies remain shell/extension adapters -> semantic application service;
  no engine dependency on tray/browser state. Android/Crostini keep their
  existing platform choices; desktop-only intent changes must not auto-launch
  either ChromeOS backend or alter mobile lifetime policy.

## Ordered Work And Evidence

1. Record these rules in living topics and the campaign; inspect source/tests
   and platform references before edits. Preserve clean handoff 7ade2df9.
2. Add regressions for real popup versus restored tab, explicit Start after
   Quit, attach-only automatic attempts, delayed mount/departure and restoration.
   Implement only observed ownership/intent gaps and tray failures.
3. Run builder extension/web gates and relevant native baseline. Package
   incrementally; verify architecture, deployment target/ABI and dependencies
   before installing. Preserve exact hashes/source snapshots.
4. Through claimed Machine Control guests, prepare fresh controlled roots and
   a private transfer. Prove cold/warm toolbar launches, native tray Open,
   browser closure with continued bytes, tab/worker/browser restart and current
   library recovery, Quit with no automatic resurrection, each explicit
   relaunch route, native close policy and OS magnet/file routing. Verify the
   tray while active and idle/paused, and its removal after Quit.
5. Repeat bounded lifecycle cycles and sample processes, handles/FDs, memory
   and connection cleanup. Check stale/incompatible admission and avoid guessed
   command success or automatic duplicate command replay after disconnection.
6. Restore inherited state, remove owned artifacts/processes, park guests and
   release claims. Reconcile evidence and remaining campaign gates; commit
   completed bounded changes without pushing.

## Restart Checkpoint

Both local repositories are clean at start. Machine Control c1bb89d includes
8480463's macOS session-probe descriptor fix and a 92-minute validation; the
previous resident issue is no longer an assumed blocker. Local macOS is
suspended and resumable. Local UTM Linux/Windows are unavailable; the existing
remote Linux controller has a clean RSTorrent checkout at 07a23248 and a
powered-off native Linux guest. Recheck remote Windows doctor/credentials.
Concrete routes and claims stay outside public documentation.

### First builder checkpoint

Actual popup identity now gates automatic toolbar launch. A direct/restored
popup tab may check setup but needs its Launch button; uncertain platform
identification never auto-launches desktop. The companion now gives a cached
page a fresh attach-only owner after its prior asynchronous mount/cleanup
finishes. Departure releases the ownership loop even if a frozen page never
receives the WebSocket close event. No launch state or credential is persisted.

After `source ~/.profile`: `npm test --prefix clients/extension` passes 42
cases plus package validation; `npm run typecheck --prefix clients/web` passes;
`npm test --prefix clients/web` passes 413 cases with two skipped. Eight focused
companion cases cover automatic retries, explicit Start/double click,
authentication refusal, mount failure, disconnect cleanup and cached-page
restoration including delayed mount and absent socket-close delivery.
`npm run package --prefix clients/extension` passes. These are deterministic
builder results; installed cross-platform evidence remains open.

### Installed macOS activation finding

An OS magnet delivered to a background owner with no native window deadlocked
its main thread before creating that window. A guest `sample` shows
`tauri-plugin-deep-link::on_event -> emit -> on_open_url ->
restore_main_window -> prepare_pending_webview -> plugins.lock`. Tauri 2.11.5
holds its plugin-store lock during plugin event delivery; webview creation
needs that same lock. `run_on_main_thread` executes inline on the main thread,
so wrapping the callback with it would retain the deadlock.

Handle macOS file and magnet URLs in the application's `RunEvent::Opened`
callback, after Tauri finishes plugin delivery and releases that lock. Keep
the deep-link callback on Windows/Linux, where the single-instance plugin
forwards URL events outside this macOS plugin dispatch. This adds no task,
queue, browser-routing state or retry. Installed regression must start without
a native window, deliver the OS magnet, then prove native presentation,
responsive commands, same owner and joined Quit; repeat cold file/magnet intake.

The macOS correction passes `cargo test -p rstorrent-desktop --lib` (53),
`cargo clippy -p rstorrent-desktop --all-targets -- -D warnings`, and formatting.
The rebuilt unsigned debug desktop SHA-256 is
`4c57171f2be1ff89e130612e8cca5ecb06525149536ea0e7333603b5b258b409`.
Installed reproduction now passes: cold extension toolbar -> absent native
window -> OS `open 'magnet:?xt=urn:btih:<fixture-hash>'` -> native window and
Already in your session, with the same runtime/library and responsive snapshot.
Native Cmd-Q then cold OS `open <fixture.torrent>` starts a new owner and native
window, restoring the same verified 512-piece fixture. The hung pre-fix test
process required targeted termination; it is not counted as Quit evidence.

### Desktop connection resource contract

Rapid installed Linux reloads exhausted the global 32 view-set limit: each
new page creates a fresh client identity, and departed sets remain leased for
five minutes. This is bounded retention, not an unbounded memory leak, but it
makes repeated desktop UI reopening unavailable. The companion deliberately
rebuilds its view on reconnect and cannot resume a departed page's view set.

Desktop-control disconnect therefore retires that authenticated connection
owner's view sets after joining calls and attachment pumps, before releasing
its registry generation. Same-client takeover waits for this cleanup. Other
owners (including the native UI) remain intact. Ordinary headless/remote and
ChromeOS connections retain their existing resumable leases; no wire change,
engine change or Android policy change is needed. Resource limits stay 32
sets globally/eight per owner and four desktop connections. Validate more than
32 create/drop cycles, an unattached set, same-client takeover, unaffected
second-owner state and waiter termination before repeating installed cycles.

The focused owner-retirement and 64-client desktop WebSocket regressions pass
on the macOS builder (`cargo test -p rstorrent-session retiring_one_owner`
and `cargo test -p rstorrent-gateway departed_pages_and_takeover`). Full
session/gateway suites and final installed rebuilds remain in progress.

### Qualification evidence (2026-09-29)

Builder gates after the resource fix: `cargo test -p rstorrent-session -p
rstorrent-gateway` passes 409 tests, with two existing ignored session tests;
`cargo clippy -p rstorrent-session -p rstorrent-gateway --all-targets -- -D
warnings` passes. Earlier desktop library tests pass 53 cases and desktop
Clippy passes. Extension tests pass 42 cases plus package validation; web
typecheck and all 413 web tests pass (two skipped). These are builder tests,
not installed platform evidence or a full workspace/Android qualification.
Before the final resource fix, the Linux builder also passes `cargo test -p
rstorrent-desktop -p rstorrent-native-host` (72 across library/binary suites)
and `cargo clippy -p rstorrent-desktop -p rstorrent-native-host --all-targets --
-D warnings`. The final resource fix is covered by the 409-test suite above
and the rebuilt installed packages; do not relabel the earlier Linux Clippy
run as a final-source pass. The unchanged Windows native-host suites pass
14 tests (12 library and two binary cases).

All installed experiments use exclusively claimed guests through Machine
Control's common CLI, a fresh native-selected root/library, and separately
identified Chrome for Testing 151.0.7922.34. The Linux desktop requires its
normal status-indicator support. Windows may place the icon in tray overflow;
the icon remains accessible there. Unsigned debug packages do not qualify
distribution signing or production release readiness. Windows debug launches
can also expose a console; the release subsystem attribute is unchanged.

The independently generated private fixture has 32 MiB, 512 64-KiB pieces,
infohash `5b6fd1f3a92b3661ecfef63f4412edfaea3d48c4`, and payload SHA-256
`99080b09c925782f67975d36476f171ee4e8b367e2a893d07a88bd70028b3fe8`.
`tests/interop/desktop_extension_seed.py` serves only controlled guest traffic.
The client download limit is 262144 bytes/s: libtorrent's seed upload limit
does not constrain its LAN exemption. `partial-transfer` proves 12/512 pieces
on macOS/Windows and 11/512 on Linux before closing the browser and native
window. Independent file hashing after that interval matches all 33,554,432
bytes on every guest. Tray Show restores the native library with the browser
closed. The transfer runs precede the final resource-cleanup rebuild; final
builds recover those same verified libraries. No personal files or public swarm
are involved.

Reproducible installed harness commands, run inside the claimed guest with
`RSTORRENT_PLAYWRIGHT_MODULE` pointing to its existing `playwright-core/index.mjs`
where necessary (CDP defaults to the owned browser's loopback port 9222):

```sh
node scripts/verify-desktop-intent-lifecycle.mjs toolbar
node scripts/verify-desktop-intent-lifecycle.mjs cycles
node scripts/verify-desktop-intent-lifecycle.mjs discard
node scripts/verify-desktop-intent-lifecycle.mjs incompatible
node scripts/verify-desktop-extension-checkpoint.mjs clicks
node scripts/verify-desktop-extension-checkpoint.mjs race
node scripts/verify-desktop-extension-checkpoint.mjs invalid
node scripts/verify-desktop-extension-checkpoint.mjs remember
# Quit using the native menu; keep this page loaded for the stale-token check.
node scripts/verify-desktop-extension-checkpoint.mjs stopped
node scripts/verify-desktop-extension-checkpoint.mjs start
node scripts/verify-desktop-extension-checkpoint.mjs stale
# Quit again before passive recovery testing.
node scripts/verify-desktop-intent-lifecycle.mjs passive-stopped
```

`toolbar` calls Chrome's actual action-popup API; native toolbar clicks are
separately observed through Machine Control. `cycles` performs 64 page reloads
and 64 worker stops, checking the same runtime identity each time. `discard`
uses Chrome's actual tab discard/activation, not a simulated page event.
`passive-stopped` restores/reloads the companion and popup URL tabs twice,
stops workers twice, waits 35 seconds, and requires no runtime plus a visible
Start button. Credentials retained for `stale` stay only in page memory.
`incompatible` rejects protocol 999 without a bootstrap result or runtime change.

For transfer evidence use `prepare-limited`, `transfer`, `partial-transfer`,
then `browser-close`, native window close and independent OS file hashing.
Set `RSTORRENT_TEST_TORRENT_NAME=checkpoint-transfer.bin` and
`RSTORRENT_TEST_TORRENT_FILE` to the controlled fixture. Windows hashing while
the completed file remains open uses a read-only stream with `FileShare.ReadWrite`;
Linux/macOS use `sha256sum`/`shasum -a 256`. The harness reports authoritative
`verified_piece_count`/`piece_count`; the prior unused field names omitted that
evidence rather than proving partial progress.

Final macOS and Linux resource builds pass 64 cycles, discard, native control
convergence, Quit/35-second stopped observation, explicit Start and stale-token
rejection. Five two-second runtime samples after/during this bounded run were
macOS 87,808–87,872 KiB RSS with 25 descriptors, and Linux 84,960–84,984 KiB RSS
with 38–39 descriptors, before opening the native webview. These are samples,
not a process-tree high-water bound or an endurance/memory-leak claim. Both
extension-only launches have no native window; ordinary launch opens it.

The final Windows NSIS install passes the same 64-cycle, discard, repeated
toolbar, 12-request singleton race and invalid/incompatible admission checks.
Its extension-only runtime has an overflow tray icon and no native window.
Five two-second samples were 29,782,016–29,806,592 working-set bytes and 228
handles; a later sample was 30,150,656 bytes and 226 handles. No browser/webview
process-tree bound is inferred. Native close with Run in Background disabled
exits; 35 seconds of retries stay stopped, explicit Start launches again and
old credentials are refused. macOS and Linux pass this close-policy check too.

OS association evidence uses guest `open <magnet-or-torrent>` on macOS,
guest `xdg-open <magnet-or-torrent>` on Linux, and guest ShellExecute through
`Start-Process <magnet-or-torrent>` on Windows. Native window enumeration and
authenticated snapshots independently prove presentation and the same restored
library. The first Linux attempt immediately after Quit returned launcher
success without a window and is not counted; after confirmed termination,
cold magnet and file launches pass. An action-popup test after closing every
Linux browser tab could not find an active browser window; the explicit Launch
button successfully reopened the companion. That harness precondition failure
is not a native toolbar or bootstrap result.

Final macOS, Linux and Windows repeat picker Cancel, browser disconnection and
Quit cleanup. Cancel appears in the extension and re-enables Add folder;
disconnection removes the dialog process; Quit removes runtime and owned
helpers and passive restoration remains stopped for 35 seconds. macOS also
reselects the existing controlled root through AppKit. AX can report an action
error as the helper exits; independent browser/process observations decide the
result. Initial fresh-root selection and the comprehensive selection/repair
matrix remain recorded with the installed Tactical 232 evidence. This slice
does not change picker security or registration contracts.

### Final artifacts and reproducibility

All final desktop packages contain production source through `bbe24600`;
`4f639316` owns the macOS activation correction and `662c55f1` the extension/page
intent correction. Windows used a preserved-source overlay in its existing
builder cache; Linux fast-forwarded from the verified handoff using a local
Git bundle, without a remote change or push. Architectures were checked before
transfer: macOS arm64, desktop minimum 13.0/helper 11.0 on macOS 26.6.2 (25G83);
Linux x86_64 on Ubuntu/glibc 2.39 with resolved installed dependencies; Windows
x86_64 MSVC on Windows 11 build 26200. Existing incremental caches were reused.

After `source ~/.profile` (plus the existing Node environment on the Linux
builder), package from `clients/desktop`:

```sh
../web/node_modules/.bin/tauri build --debug \
  --config src-tauri/tauri.package.conf.json --bundles app --no-sign --ci
# Linux: --bundles deb; Windows: tauri.cmd and --bundles nsis.
```

Windows uses its pinned `cargo-about` 0.9.2 for dependency notices. No source
dependency or release identity changed. Existing dependency warnings and
Windows-only unused-variable warnings do not constitute a Windows Clippy pass.

| Artifact | SHA-256 |
| --- | --- |
| Packaged beta extension 0.4.0 | `3b05241b4a8d59abb3e62443137756672bf6d059e3da9d1464e74f8254d7a0be` |
| macOS installed desktop executable | `e3a3fc17ce2aed822f118ffca61f784d886def7816bfbc341b27c2007b33ff8e` |
| macOS native host (unchanged) | `9737e093124c933864b25031ab1a27679e6e055c204fb29423cab3a292429000` |
| Linux final DEB | `88b72903d8c8cda83e88a073ff83c0b875787484dcf14f41837dcc8b9608af85` |
| Linux installed desktop executable | `c490dfa9124ce8f6e8f2c0ff0b5d9a35349a22dadbdf94d99c983b8d7e90d73e` |
| Windows final NSIS installer | `7a4d6d19ba858a5435efce23ae484e86e8d6ff4e52ab68be37be592e3dbe8fc9` |
| Windows installed desktop executable | `92eebfa23ded6c694a28f70838de8043dc09fc6c6db67c1e5c07767100ca8c9a` |

### Cleanup and remaining boundaries

macOS has no inherited RSTorrent installation/profile. After real Quit and
CDP browser close, owned runtime/helper/browser processes are absent. Unregister
the two task app bundles; remove the installed app, fresh app/browser support,
preferences/cache/WebKit, controlled root and the one task capture. The saved
LaunchServices dictionary is unchanged. Restore the inherited Terminal and
suspended state; release the claim. These cleanup checks pass.

Linux restores its original idle delay (300) and lock setting (true), removes
the test-only AppArmor profile while preserving the browser sandbox, removes
the task DEB and isolated home/root/browser payload, and deletes its task
capture. Runtime/helpers and Chrome for Testing are gone. The private seed
finishes; its exact controller firewall rule is removed. Restore the initial
powered-off state and release the claim. These cleanup checks pass.

Windows native Start on the final build converges in the extension after
extension Pause, and cold OS file intake shows Already in your session with
the same verified library. Real Quit and CDP browser close leave no runtime,
picker helper or test browser. Restoration of five inherited app/profile/shortcut
paths independently verifies all 317 saved file hashes; seven saved registry
keys are restored and their exports compared. Remove the task root, fresh
Playwright browser cache and task-opened Settings window, then restore the
initial powered-off state and release the claim. Final cleanup passed: owned paths/processes are absent, Windows is off and its claim is
released. All three guests are parked in their inherited state and all claims
are released. Controller temporary fixtures, downloads, logs and captures are
removed after recording evidence; incremental builder caches remain. Neither
Machine Control checkout needs a change for this checkpoint.

Remaining work is a separate bounded tactical for longer browser/OS
suspension and endurance, browser families/profile variants, and installer/
extension update-order compatibility. Protocol-999 and stale-token rejection
do not qualify a mixed-version release matrix. There is no auto-shutdown,
icon-hiding preference, website-wide magnet interception, importer, personal
migration, production identity/route change, push, tag or release here.

First lifecycle follow-up: instrument and repeat the immediate Linux
Quit/OS-launch overlap that returned launcher success without a window.
Shutdown overlap is a hypothesis, not an established cause. This checkpoint
qualifies relaunch after confirmed runtime termination; it does not qualify
delivery of activation arriving while the previous owner is still exiting.
