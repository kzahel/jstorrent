# Tactical 235: Linux Quit / Launch Handoff

Status: **Complete, 2026-09-29.** Parent campaign [231](231-jstorrent-migration-working-campaign.md);
follow-up to [234](234-desktop-user-intent-and-background-lifecycle.md).
Topics: `client-surfaces`, `runtime-configurations-and-headless-deployment`.

## Scope And Stopping Condition

Explain and repair the Linux launch immediately after Quit that returned
launcher success without a runtime/window in Tactical 234. Qualify ordinary
launch, OS magnet/file delivery and explicit background launch across the
shutdown boundary. Stop after deterministic/scripted builder tests and an
installed isolated Linux guest pass, with exact artifacts and cleanup recorded.
Update compatibility is the next separate bounded tactical; no importer,
personal migration, production identities/routes, publication or release claim.

## Invariants And Ownership

- One desktop application service/library owner. A waiting launcher must not
  construct an engine while another instance still owns admission.
- A launch admitted before Quit may be superseded by that Quit. Fresh explicit
  intent arriving during shutdown must be retained by its launcher until the
  old owner exits, or fail visibly after a bounded wait.
- No passive reconnect, startup observer or page restoration creates launch
  intent. No restart flag, durable pending launch, background relaunch helper
  or browser-profile routing is introduced.
- Preserve background versus native-window intent and the existing eight-input
  intake bound; never log magnet contents, torrent paths or credentials.
- Keep process arbitration in the Linux desktop adapter, outside application,
  protocol and torrent state. macOS/Windows and Android ownership are unchanged.

## Source Review And Plan

Pinned `tauri-plugin-single-instance` 2.4.3
`src/platform_impl/linux.rs::ExecuteCallback` returns no admission result.
Its secondary process discards the D-Bus call result and exits zero even if the
old primary disappears. `lib.rs::handle_external_activation_values` queues
inputs during Stopping, while `restore_main_window` deliberately does nothing.
This combination can lose post-Quit intent. Verify in the installed baseline
before selecting the final repair. No upstream source is copied.

Official [Tauri single-instance documentation](https://v2.tauri.app/plugin/single-instance/)
describes secondary launch notification and process exit. Review the exact
pinned source for behavior beyond that public description. Existing joined
shutdown owns picker, desktop control, view subscriptions, application service
and media termination; do not release singleton admission before those join.

1. Reproduce with the cached Tactical 234 DEB in a claimed, initially powered-off
   Linux guest, using a new task-owned HOME and real tray Quit.
2. Select bounded acknowledgement/retry behavior based on that evidence.
   Record timeout, admission limits, cancellation and failure ownership before
   adding runtime work.
3. Test startup, warm delivery, shutdown retry, unavailable bus, timeouts,
   concurrent launches and no-intent termination on the Linux builder first.
4. Install the changed package and repeat native/background/magnet/file cases,
   counting actual process/window effects rather than launcher exit alone.
5. Restore guest installation/profile state, power and claims. Commit the
   bounded result and carry update compatibility into its own tactical.

No engine, application contract, React or mobile behavior is changed by this
Linux process-admission investigation, so engine oracle and Android runtime
parity tests are inapplicable unless implementation scope changes.

## Execution Evidence

Initial repository: clean `2ddb0e27`, with Linux handoff `07a23248` present.
Linux builder: clean `bbe24600`; cached DEB SHA-256
`88b72903d8c8cda83e88a073ff83c0b875787484dcf14f41837dcc8b9608af85`.
Common Machine Control discovery/doctor finds the remote Linux target powered
off; exclusive claim and `target ensure-ready` produce a ready unlocked guest
through target-native administration/semantic routes. No inherited RSTorrent
package/process exists. Guest x86_64, Ubuntu glibc 2.39 matches the cached DEB.

Baseline evidence: twenty immediate full-process ordinary launches after real
tray Quit all survived as a replacement. Twelve tighter trials sent the exact
`org.SingleInstance.DBus.ExecuteCallback(as, s)` message after tray Quit:
all twelve observed the old singleton name still owned, a successful empty
reply, then old-process exit with no tray. These are installed IPC-boundary
trials, not twelve full OS association failures; they isolate the lost-admission
window that the slower launcher trials missed.

### Selected Repair And Resource Contract

Use a small independently written Linux desktop admission adapter over the
already-present zbus dependency. Retain the exact Tauri D-Bus name, object path,
interface, method and successful empty reply for old/new warm interoperability.
Return a named retry error while setup is incomplete or shutdown is stopping;
reject failed shutdown. New launchers retry name acquisition or delivery for
an eight-second retry budget, sleeping 25 ms between retry responses, with
one-second IPC call deadlines. Two in-flight calls can extend the last
iteration by at most two seconds. Timeout/unknown/malformed replies fail closed, without
starting an engine or reporting successful delivery. Bus-owner disappearance
may retry acquisition; no forced replacement or queued name ownership.

The process owns one connection; export admission before claiming its name,
keep the name through joined service shutdown, and release on the terminal
Exit event. Waiting secondary processes own their original arguments and no
engine, tray, service, profile or helper. Terminating the launcher cancels its
wait. There is no persisted restart request. Bound each call to 64 arguments,
512 KiB aggregate argument bytes and 64 KiB cwd. A 16-permit main-thread
delivery bound caps queued argument payloads at 8 MiB; saturation replies Retry.
Existing intake limits still apply. IPC errors never print caller contents. These are same-user session-bus
activation semantics, not extension authentication or a cross-user boundary.

Admission checks the atomic shutdown phase before queuing main-thread delivery;
a request accepted before Quit is allowed to be superseded by that Quit.
Requests observed after Stopping retry. Native creation stays on the main
thread. Linux warm inputs are classified directly once, without the upstream
plugin's implicit deep-link pre-dispatch; cold input remains the existing path.
macOS/Windows keep their pinned plugin unchanged. Old binaries retain their
old shutdown race; this repair cannot retrofit acknowledgement into them.

Required builder tests use an owned private D-Bus daemon and real message
exchange, covering warm delivery, startup/stop retry, owner disappearance,
concurrent arbitration, argument bounds, deadline and unavailable bus. No
installed product UI or host browser is used for those tests.

### Implemented Checkpoint

The selected adapter is `clients/desktop/src-tauri/src/linux_single_instance.rs`.
It preserves warm Tauri wire compatibility, refuses startup/stopping admission
with Retry, and fails closed on failed shutdown, malformed acknowledgement,
unavailable bus or ambiguous delivery timeout. The last case is deliberately
not replayed: the existing owner may already have accepted the request.
Only ServiceUnknown/NameHasNoOwner and the explicit Retry error are retryable.
The official [D-Bus specification](https://dbus.freedesktop.org/doc/dbus-specification.html#bus-messages-request-name)
confirms exclusive name ownership and DoNotQueue semantics. Pinned zbus 5.19.0
`connection::request_name_with_flags` maps Exists to NameTaken; its blocking
builder supplies the per-call deadline. No dependency or copied source added.

Builder validation (source `~/.profile`, and the Linux Node environment for
packaging):

```sh
cargo fmt --all -- --check
cargo test -p rstorrent-desktop --lib
cargo clippy -p rstorrent-desktop --all-targets -- -D warnings
# Linux builder, from clients/desktop:
../web/node_modules/.bin/tauri build --debug \
  --config src-tauri/tauri.package.conf.json --bundles deb --no-sign --ci
```

macOS desktop tests: 53 passed; Clippy passed. Linux final full suite: 62
passed, including nine Linux admission tests. Linux Clippy passed; pre-existing vendored GLib
warnings remain dependency warnings. This is no Windows installed regression
claim: that platform's plugin behavior and code body are unchanged.

Installed reusable runner (inside the claimed guest's ordinary desktop session):

```sh
python3 scripts/verify-linux-launch-handoff.py \
  --executable /usr/bin/rstorrent-desktop --work-dir "$OWNED_TEST_ROOT"
# Use --baseline with the Tactical 234 package to record prior behaviour.
```

The runner uses task-owned HOME/XDG directories, real tray D-Bus menu Quit,
process exit status, the actual singleton owner's PID, and AT-SPI visible
window enumeration. It refuses an inherited runtime. No test browser is needed.

- Baseline runner: 12/12 post-Quit IPC requests acknowledged and lost.
- Candidate runner: 12/12 receive Retry. The first candidate run proved this
  but a cached Python BusName invalidated its second controlled fixture; the
  corrected runner explicitly reacquires its test name before proceeding.
- Real installed launcher against a scripted stopping owner: three Retry
  replies, then one windowless runtime after release.
- Deliberately held owner: launcher exits nonzero after 8.056 seconds and
  300 replies; no tray/second runtime. Its bounded diagnostic reports timeout.
- Real tray Quit followed immediately by ordinary, background, magnet and
  file executable launches: one replacement; one native window for native/
  magnet/file, zero for background.
- Actual `xdg-open` magnet and `.torrent` delivery immediately after Quit:
  both create a replacement native window. No torrent is admitted to transfer;
  test inputs only exercise intake presentation.
- Twelve concurrent background launch processes: one surviving owner and
  eleven acknowledged exits, no native window. A subsequent normal launch
  reuses that owner and shows its native window.
- Final real Quit, followed by 35 seconds without new intent: no owner/tray.

Final installed DEB SHA-256:
`f797456de043dd7002f5f4bb3d0c537b18f04c7e55ed0efef83d99f3b6c5576c`.
Installed executable SHA-256:
`7c8b9a823702ee7c3d9050597c51a6070c412c1776f6e166fb784db45e689232`.
The installed production source includes the final admission bound; the later
additional regression only adds test code. No importer or payload migration ran.

### Remaining Scope

Older launchers still ignore error replies; an already-running old desktop
cannot gain the new shutdown response through a new caller alone. Full
extension/runtime and signed installer/update compatibility remains separate.
This fixes the isolated Linux boundary, not broader OS/browser endurance or
release readiness. At the end of the combined 235/236 session, the installed
package and owned processes, profiles, fixtures and captures were removed.
Initial idle-delay (300 seconds), screen locking and powered-off state were
restored; the exclusive claim was released. No Machine Control changes were
needed.
